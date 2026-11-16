// Package store is the metadata half of the product: SQLite rows that describe a paste whose bytes
// live on the content tree. It shares the paste types so there is one definition of a row.
package store

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"

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
  id       INTEGER PRIMARY KEY,
  paste_id INTEGER NOT NULL REFERENCES pastes(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  mime     TEXT NOT NULL,
  size     INTEGER NOT NULL,
  rel      TEXT NOT NULL,
  sort     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS burned (
  slug TEXT PRIMARY KEY,
  at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pastes_updated ON pastes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pastes_expires ON pastes(expires_at) WHERE expires_at IS NOT NULL;
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
	// One writer, one reader: a pastebin does not need a pool, and this removes SQLITE_BUSY.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
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
		SELECT id, name, mime, size, rel, sort FROM files WHERE paste_id = ? ORDER BY sort`, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var f paste.File
		if err := rows.Scan(&f.ID, &f.Name, &f.Mime, &f.Size, &f.Rel, &f.Sort); err != nil {
			return nil, err
		}
		p.Files = append(p.Files, f)
	}
	return &p, rows.Err()
}

func (s *Store) List(ctx context.Context) ([]paste.Paste, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT slug, title, language, kind, text_bytes, file_bytes, file_count, views, burn,
		       expires_at, created_at, updated_at
		FROM pastes ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]paste.Paste, 0, 32)
	for rows.Next() {
		var p paste.Paste
		var burn int
		var expires sql.NullInt64
		if err := rows.Scan(&p.Slug, &p.Title, &p.Language, &p.Kind, &p.TextBytes, &p.FileBytes,
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
	return tx.Commit()
}

func (s *Store) Delete(ctx context.Context, slug string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM pastes WHERE slug = ?`, slug)
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
	return nil
}

func (s *Store) Purge(ctx context.Context) ([]string, error) {
	slugs, err := s.slugs(ctx, "")
	if err != nil {
		return nil, err
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM pastes`); err != nil {
		return nil, err
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM burned`); err != nil {
		return nil, err
	}
	return slugs, nil
}

func (s *Store) Expired(ctx context.Context, now int64) ([]string, error) {
	return s.slugs(ctx, "WHERE expires_at IS NOT NULL AND expires_at <= "+itoa(now))
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

func (s *Store) Count(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM pastes`).Scan(&n)
	return n, err
}

func insertFiles(ctx context.Context, tx *sql.Tx, pasteID int64, files []paste.File) error {
	for index := range files {
		file := &files[index]
		res, err := tx.ExecContext(ctx, `
			INSERT INTO files (paste_id, name, mime, size, rel, sort) VALUES (?, ?, ?, ?, ?, ?)`,
			pasteID, file.Name, file.Mime, file.Size, file.Rel, file.Sort)
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

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func itoa(n int64) string {
	return strconvFormat(n)
}
