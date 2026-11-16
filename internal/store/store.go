// Package store is the metadata half of the product: SQLite rows that describe a paste whose bytes
// live on the content tree. It also owns the search index — one writer, one transaction, no drift.
package store

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"github.com/jakobbjelver/messer-paste/internal/paste"
)

const schema = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS pastes (
  id         INTEGER PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL DEFAULT '',
  language   TEXT NOT NULL DEFAULT 'text',
  kind       TEXT NOT NULL,
  text_bytes INTEGER NOT NULL DEFAULT 0,
  file_bytes INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  views      INTEGER NOT NULL DEFAULT 0,
  burn       INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id        INTEGER PRIMARY KEY,
  paste_id  INTEGER NOT NULL REFERENCES pastes(id) ON DELETE CASCADE,
  public_id TEXT NOT NULL DEFAULT '',
  name      TEXT NOT NULL,
  mime      TEXT NOT NULL,
  size      INTEGER NOT NULL,
  rel       TEXT NOT NULL,
  sort      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS burned (
  slug TEXT PRIMARY KEY,
  at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  key      TEXT PRIMARY KEY,
  body     BLOB NOT NULL,
  at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pastes_updated ON pastes(updated_at DESC, slug DESC);
CREATE INDEX IF NOT EXISTS idx_pastes_expires ON pastes(expires_at) WHERE expires_at IS NOT NULL;
`

// Trigram, not unicode61: a filename search has to match inside a word ("shot" finds
// portal-shot.jpg), and trigram is the only tokenizer that does that.
const schemaSearch = `
CREATE VIRTUAL TABLE IF NOT EXISTS pastes_fts USING fts5(
  title, files, body, tokenize = 'trigram'
);
`

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	for _, statement := range []string{schema, schemaSearch} {
		if _, err := db.Exec(statement); err != nil {
			db.Close()
			return nil, err
		}
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// migrate adds columns that older DBs lack. SQLite has no ADD COLUMN IF NOT EXISTS, so the column
// list decides.
func (s *Store) migrate() error {
	rows, err := s.db.Query(`PRAGMA table_info(files)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	hasPublic := false
	for rows.Next() {
		var cid int
		var name, kind string
		var notNull, pk int
		var def any
		if err := rows.Scan(&cid, &name, &kind, &notNull, &def, &pk); err != nil {
			return err
		}
		if name == "public_id" {
			hasPublic = true
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	rows.Close()
	if !hasPublic {
		if _, err := s.db.Exec(`ALTER TABLE files ADD COLUMN public_id TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}
	// After the column exists: an index in the base schema would fail on an older files table, which
	// is exactly how the first v0.2 deploy crash-looped.
	_, err = s.db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_files_public ON files(paste_id, public_id)`)
	return err
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }

func (s *Store) Create(ctx context.Context, p *paste.Paste, files []paste.File) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck // rollback after commit is a no-op

	res, err := tx.ExecContext(ctx, `
		INSERT INTO pastes (slug, title, language, kind, text_bytes, file_bytes, file_count,
		                    views, burn, expires_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
		p.Slug, p.Title, p.Language, p.Kind, p.TextBytes, p.FileBytes, p.FileCount,
		boolInt(p.Burn), p.ExpiresAt, p.CreatedAt, p.UpdatedAt)
	if err != nil {
		return err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return err
	}
	p.ID = id
	if err := insertFiles(ctx, tx, id, files); err != nil {
		return err
	}
	if err := index(ctx, tx, p, files); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Get(ctx context.Context, slug string) (*paste.Paste, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, slug, title, language, kind, text_bytes, file_bytes, file_count, views, burn,
		       expires_at, created_at, updated_at
		FROM pastes WHERE slug = ?`, slug)

	var p paste.Paste
	var burn int
	var expires sql.NullInt64
	if err := row.Scan(&p.ID, &p.Slug, &p.Title, &p.Language, &p.Kind, &p.TextBytes, &p.FileBytes,
		&p.FileCount, &p.Views, &burn, &expires, &p.CreatedAt, &p.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, paste.ErrNotFound
		}
		return nil, err
	}
	p.Burn = burn == 1
	if expires.Valid {
		value := expires.Int64
		p.ExpiresAt = &value
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, public_id, name, mime, size, rel, sort FROM files WHERE paste_id = ? ORDER BY sort`, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var f paste.File
		if err := rows.Scan(&f.ID, &f.PublicID, &f.Name, &f.Mime, &f.Size, &f.Rel, &f.Sort); err != nil {
			return nil, err
		}
		p.Files = append(p.Files, f)
	}
	return &p, rows.Err()
}

// List is the archive: keyset pagination on (updated_at, slug), and a search path that goes through
// the trigram index. Search results are ranked, so they do not take a cursor — the top matches are
// the answer.
func (s *Store) List(ctx context.Context, opts paste.ListOptions) (paste.ListResult, error) {
	limit := opts.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	query := strings.TrimSpace(opts.Query)
	if query != "" {
		return s.search(ctx, query, limit)
	}

	where := ""
	args := []any{}
	if opts.Cursor != "" {
		at, slug, err := decodeCursor(opts.Cursor)
		if err != nil {
			return paste.ListResult{}, fmt.Errorf("%w: bad cursor", paste.ErrInvalid)
		}
		where = "WHERE (updated_at < ? OR (updated_at = ? AND slug < ?))"
		args = append(args, at, at, slug)
	}
	args = append(args, limit+1)
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, slug, title, language, kind, text_bytes, file_bytes, file_count, views, burn,
		       expires_at, created_at, updated_at
		FROM pastes `+where+`
		ORDER BY updated_at DESC, slug DESC
		LIMIT ?`, args...)
	if err != nil {
		return paste.ListResult{}, err
	}
	defer rows.Close()

	out, err := scanPastes(rows)
	if err != nil {
		return paste.ListResult{}, err
	}
	result := paste.ListResult{Items: out}
	if len(out) > limit {
		last := out[limit-1]
		result.Items = out[:limit]
		result.HasMore = true
		result.Next = encodeCursor(last.UpdatedAt, last.Slug)
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM pastes`).Scan(&result.Total); err != nil {
		return paste.ListResult{}, err
	}
	return result, nil
}

func (s *Store) search(ctx context.Context, query string, limit int) (paste.ListResult, error) {
	// Trigram needs three characters; below that a substring scan of the title and filenames is both
	// correct and cheap, and the body is not scanned at all.
	if len([]rune(query)) < 3 {
		return s.searchPlain(ctx, query, limit)
	}

	match := ftsQuery(query)
	rows, err := s.db.QueryContext(ctx, `
		SELECT p.id, p.slug, p.title, p.language, p.kind, p.text_bytes, p.file_bytes, p.file_count,
		       p.views, p.burn, p.expires_at, p.created_at, p.updated_at,
		       snippet(pastes_fts, 0, char(1), char(2), '…', 12),
		       snippet(pastes_fts, 1, char(1), char(2), '…', 12),
		       snippet(pastes_fts, 2, char(1), char(2), '…', 12),
		       bm25(pastes_fts, 12.0, 5.0, 1.0)
		FROM pastes_fts JOIN pastes p ON p.id = pastes_fts.rowid
		WHERE pastes_fts MATCH ?
		ORDER BY rank, p.updated_at DESC
		LIMIT ?`, match, limit+1)
	if err != nil {
		return paste.ListResult{}, err
	}
	defer rows.Close()

	result := paste.ListResult{Items: make([]paste.Paste, 0, limit)}
	for rows.Next() {
		var p paste.Paste
		var burn int
		var expires sql.NullInt64
		var titleSnip, fileSnip, bodySnip string
		var rank float64
		if err := rows.Scan(&p.ID, &p.Slug, &p.Title, &p.Language, &p.Kind, &p.TextBytes, &p.FileBytes,
			&p.FileCount, &p.Views, &burn, &expires, &p.CreatedAt, &p.UpdatedAt,
			&titleSnip, &fileSnip, &bodySnip, &rank); err != nil {
			return paste.ListResult{}, err
		}
		p.Burn = burn == 1
		if expires.Valid {
			value := expires.Int64
			p.ExpiresAt = &value
		}
		p.Match = pickMatch(titleSnip, fileSnip, bodySnip)
		result.Items = append(result.Items, p)
	}
	if err := rows.Err(); err != nil {
		return paste.ListResult{}, err
	}
	if len(result.Items) > limit {
		result.Items = result.Items[:limit]
		result.HasMore = true
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM pastes_fts WHERE pastes_fts MATCH ?`, match).Scan(&result.Total); err != nil {
		return paste.ListResult{}, err
	}
	return result, nil
}

func (s *Store) searchPlain(ctx context.Context, query string, limit int) (paste.ListResult, error) {
	like := "%" + query + "%"
	rows, err := s.db.QueryContext(ctx, `
		SELECT p.id, p.slug, p.title, p.language, p.kind, p.text_bytes, p.file_bytes, p.file_count,
		       p.views, p.burn, p.expires_at, p.created_at, p.updated_at,
		       COALESCE((SELECT name FROM files WHERE paste_id = p.id AND name LIKE ? LIMIT 1), '')
		FROM pastes p
		WHERE p.title LIKE ? OR EXISTS (SELECT 1 FROM files WHERE paste_id = p.id AND name LIKE ?)
		ORDER BY p.updated_at DESC
		LIMIT ?`, like, like, like, limit+1)
	if err != nil {
		return paste.ListResult{}, err
	}
	defer rows.Close()

	result := paste.ListResult{Items: make([]paste.Paste, 0, limit)}
	for rows.Next() {
		var p paste.Paste
		var burn int
		var expires sql.NullInt64
		var fileName string
		if err := rows.Scan(&p.ID, &p.Slug, &p.Title, &p.Language, &p.Kind, &p.TextBytes, &p.FileBytes,
			&p.FileCount, &p.Views, &burn, &expires, &p.CreatedAt, &p.UpdatedAt, &fileName); err != nil {
			return paste.ListResult{}, err
		}
		p.Burn = burn == 1
		if expires.Valid {
			value := expires.Int64
			p.ExpiresAt = &value
		}
		if fileName != "" {
			p.Match = &paste.Match{Field: "files", Snippet: fileName}
		} else {
			p.Match = &paste.Match{Field: "title", Snippet: p.Title}
		}
		result.Items = append(result.Items, p)
	}
	if err := rows.Err(); err != nil {
		return paste.ListResult{}, err
	}
	if len(result.Items) > limit {
		result.Items = result.Items[:limit]
		result.HasMore = true
	}
	result.Total = len(result.Items)
	return result, nil
}

// pickMatch trusts only the columns that actually carry a marker: snippet() returns a prefix for a
// column that did not match, which would name the wrong field.
func pickMatch(title, files, body string) *paste.Match {
	const mark = "\x01"
	switch {
	case strings.Contains(title, mark):
		return &paste.Match{Field: "title", Snippet: title}
	case strings.Contains(files, mark):
		return &paste.Match{Field: "files", Snippet: files}
	case strings.Contains(body, mark):
		return &paste.Match{Field: "text", Snippet: body}
	default:
		return nil
	}
}

// ftsQuery turns arbitrary input into quoted phrases, so a stray operator cannot become syntax.
func ftsQuery(query string) string {
	terms := strings.Fields(query)
	quoted := make([]string, 0, len(terms))
	for _, term := range terms {
		term = strings.ReplaceAll(term, `"`, `""`)
		quoted = append(quoted, `"`+term+`"`)
	}
	return strings.Join(quoted, " ")
}

func scanPastes(rows *sql.Rows) ([]paste.Paste, error) {
	out := make([]paste.Paste, 0, 32)
	for rows.Next() {
		var p paste.Paste
		var burn int
		var expires sql.NullInt64
		if err := rows.Scan(&p.ID, &p.Slug, &p.Title, &p.Language, &p.Kind, &p.TextBytes, &p.FileBytes,
			&p.FileCount, &p.Views, &burn, &expires, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.Burn = burn == 1
		if expires.Valid {
			value := expires.Int64
			p.ExpiresAt = &value
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) Update(ctx context.Context, p *paste.Paste, files []paste.File) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	res, err := tx.ExecContext(ctx, `
		UPDATE pastes SET title = ?, language = ?, kind = ?, text_bytes = ?, file_bytes = ?,
		                  file_count = ?, burn = ?, expires_at = ?, updated_at = ?
		WHERE slug = ?`,
		p.Title, p.Language, p.Kind, p.TextBytes, p.FileBytes, p.FileCount,
		boolInt(p.Burn), p.ExpiresAt, p.UpdatedAt, p.Slug)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return paste.ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM files WHERE paste_id = ?`, p.ID); err != nil {
		return err
	}
	if err := insertFiles(ctx, tx, p.ID, files); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM pastes_fts WHERE rowid = ?`, p.ID); err != nil {
		return err
	}
	if err := index(ctx, tx, p, files); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Delete(ctx context.Context, slug string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := tx.ExecContext(ctx, `DELETE FROM pastes_fts WHERE rowid = (SELECT id FROM pastes WHERE slug = ?)`, slug); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM pastes WHERE slug = ?`, slug)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return paste.ErrNotFound
	}
	return tx.Commit()
}

func (s *Store) Purge(ctx context.Context) ([]string, error) {
	slugs, err := s.slugs(ctx, "")
	if err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback() //nolint:errcheck
	for _, statement := range []string{`DELETE FROM pastes_fts`, `DELETE FROM pastes`, `DELETE FROM burned`} {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return nil, err
		}
	}
	return slugs, tx.Commit()
}

// AllSlugs is for the doctor and the reconciler: everything, ordered by nothing.
func (s *Store) AllSlugs(ctx context.Context) ([]string, error) { return s.slugs(ctx, "") }

func (s *Store) Expired(ctx context.Context, now int64) ([]string, error) {
	return s.slugs(ctx, "WHERE expires_at IS NOT NULL AND expires_at <= "+strconv.FormatInt(now, 10))
}

func (s *Store) slugs(ctx context.Context, where string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT slug FROM pastes `+where)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var slug string
		if err := rows.Scan(&slug); err != nil {
			return nil, err
		}
		out = append(out, slug)
	}
	return out, rows.Err()
}

func (s *Store) IncrementViews(ctx context.Context, slug string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE pastes SET views = views + 1 WHERE slug = ?`, slug)
	return err
}

func (s *Store) MarkBurned(ctx context.Context, slug string, at int64) error {
	_, err := s.db.ExecContext(ctx, `INSERT OR REPLACE INTO burned (slug, at) VALUES (?, ?)`, slug, at)
	return err
}

func (s *Store) WasBurned(ctx context.Context, slug string) (bool, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM burned WHERE slug = ?`, slug).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func (s *Store) SearchCount(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM pastes_fts`).Scan(&n)
	return n, err
}

func (s *Store) Count(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM pastes`).Scan(&n)
	return n, err
}

// Idempotent returns the stored response for a key, if the key was used within the last day.
func (s *Store) Idempotent(ctx context.Context, key string) ([]byte, bool, error) {
	if key == "" {
		return nil, false, nil
	}
	var body []byte
	err := s.db.QueryRowContext(ctx, `SELECT body FROM idempotency WHERE key = ?`, key).Scan(&body)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return body, true, nil
}

func (s *Store) SaveIdempotent(ctx context.Context, key string, body []byte) error {
	if key == "" {
		return nil
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM idempotency WHERE at < ?`, time.Now().Add(-24*time.Hour).Unix()); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `INSERT OR REPLACE INTO idempotency (key, body, at) VALUES (?, ?, ?)`,
		key, body, time.Now().Unix())
	return err
}

// IndexAll rebuilds the search index. Called once at boot when the index is empty and rows exist,
// and by `messer-paste reindex`.
func (s *Store) IndexAll(ctx context.Context, bodies map[string]string, names map[string][]string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := tx.ExecContext(ctx, `DELETE FROM pastes_fts`); err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id, slug, title FROM pastes`)
	if err != nil {
		return err
	}
	type row struct {
		id    int64
		slug  string
		title string
	}
	var all []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.slug, &r.title); err != nil {
			rows.Close()
			return err
		}
		all = append(all, r)
	}
	rows.Close()
	for _, r := range all {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO pastes_fts(rowid, title, files, body) VALUES (?, ?, ?, ?)`,
			r.id, r.title, strings.Join(names[r.slug], "\n"), bodies[r.slug]); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func index(ctx context.Context, tx *sql.Tx, p *paste.Paste, files []paste.File) error {
	names := make([]string, 0, len(files))
	for _, file := range files {
		names = append(names, file.Name)
	}
	_, err := tx.ExecContext(ctx,
		`INSERT INTO pastes_fts(rowid, title, files, body) VALUES (?, ?, ?, ?)`,
		p.ID, p.Title, strings.Join(names, "\n"), p.Text)
	return err
}

func insertFiles(ctx context.Context, tx *sql.Tx, pasteID int64, files []paste.File) error {
	for index := range files {
		file := &files[index]
		res, err := tx.ExecContext(ctx, `
			INSERT INTO files (paste_id, public_id, name, mime, size, rel, sort) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			pasteID, file.PublicID, file.Name, file.Mime, file.Size, file.Rel, file.Sort)
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err != nil {
			return err
		}
		file.ID = id
	}
	return nil
}

func encodeCursor(at int64, slug string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.FormatInt(at, 10) + "|" + slug))
}

func decodeCursor(cursor string) (int64, string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return 0, "", err
	}
	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 {
		return 0, "", errors.New("malformed")
	}
	at, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, "", err
	}
	return at, parts[1], nil
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
