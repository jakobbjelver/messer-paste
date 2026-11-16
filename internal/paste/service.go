package paste

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"
)

type Limits struct {
	Text  int64
	File  int64
	Paste int64
	Burn  int64
}

type Incoming struct {
	Name     string
	Mime     string
	TempPath string
	Size     int64
}

type CreateInput struct {
	Title      string
	Text       string
	Language   string
	ExpiresIn  int64
	Burn       bool
	Files      []Incoming
	Visibility string
	Password   string
	MaxViews   int64
}

type UpdateInput struct {
	Title      string
	Text       string
	Language   string
	ExpiresIn  int64
	Burn       bool
	Keep       []string
	Files      []Incoming
	Visibility string
	// Password replaces the stored hash when non-empty; ClearPassword removes it. Both are ignored
	// when the paste is private: a password on something nobody else can reach is a lie in the UI.
	Password      string
	ClearPassword bool
	MaxViews      int64
}

type RevealFile struct {
	Name string `json:"name"`
	Mime string `json:"mime"`
	Data string `json:"data"`
}

type Reveal struct {
	Title    string       `json:"title"`
	Text     string       `json:"text"`
	Language string       `json:"language"`
	Files    []RevealFile `json:"files"`
}

type Store interface {
	Create(ctx context.Context, p *Paste, files []File) error
	Get(ctx context.Context, slug string) (*Paste, error)
	List(ctx context.Context, opts ListOptions) (ListResult, error)
	Update(ctx context.Context, p *Paste, files []File) error
	Delete(ctx context.Context, slug string) error
	Purge(ctx context.Context) ([]string, error)
	Expired(ctx context.Context, now int64) ([]string, error)
	IncrementViews(ctx context.Context, slug string) error
	RecordView(ctx context.Context, slug string, bucket int64, ip string) (bool, error)
	SawView(ctx context.Context, slug string, bucket int64, ip string) (bool, error)
	Count(ctx context.Context) (int, error)
	SearchCount(ctx context.Context) (int, error)
	IndexAll(ctx context.Context, bodies map[string]string, names map[string][]string) error
	MarkBurned(ctx context.Context, slug string, at int64) error
	WasBurned(ctx context.Context, slug string) (bool, error)
}

type Service struct {
	store  Store
	tree   *Storage
	limits Limits
	events Publisher
	log    *slog.Logger
}

func NewService(store Store, tree *Storage, limits Limits, events Publisher, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{store: store, tree: tree, limits: limits, events: events, log: log}
}

func (s *Service) Tree() *Storage { return s.tree }

// PublicSpec is what the public host knows about its reader: whether the unlock cookie checked out
// and which client is asking (for the once-an-hour view count).
type PublicSpec struct {
	Unlocked bool
	IP       string
}

// applyAccess validates the v0.3 fields and stamps them onto the record. Public means someone
// without the Access policy can read it, so it must expire, it cannot burn (burn consumes the body
// on a request we cannot attribute), and a password has to be long enough to be worth hashing.
// maxViews 0 means "no cap", which is also how an existing cap is removed: the form always sends
// the field, so absence is not a signal.
func applyAccess(p *Paste, visibility, password string, clearPassword bool, maxViews, expiresIn int64) error {
	switch visibility {
	case "":
		visibility = VisibilityPrivate
	case VisibilityPrivate, VisibilityPublic:
	default:
		return fmt.Errorf("%w: unknown visibility", ErrInvalid)
	}
	p.Visibility = visibility
	if visibility == VisibilityPrivate {
		p.PasswordHash = ""
		p.MaxViews = nil
		return nil
	}
	if expiresIn <= 0 {
		return fmt.Errorf("%w: a public paste must expire", ErrInvalid)
	}
	if p.Burn {
		return fmt.Errorf("%w: a public paste cannot burn", ErrInvalid)
	}
	if maxViews < 0 {
		return fmt.Errorf("%w: max views cannot be negative", ErrInvalid)
	}
	if maxViews > 0 {
		value := maxViews
		p.MaxViews = &value
	} else {
		p.MaxViews = nil
	}
	switch {
	case clearPassword:
		p.PasswordHash = ""
	case password != "":
		if len(password) < 8 {
			return fmt.Errorf("%w: a password needs at least 8 characters", ErrInvalid)
		}
		hash, err := HashPassword(password)
		if err != nil {
			return err
		}
		p.PasswordHash = hash
	}
	return nil
}

func (s *Service) List(ctx context.Context, opts ListOptions) (ListResult, error) {
	return s.store.List(ctx, opts)
}

// BackfillSearch rebuilds the index when it is empty but rows exist (a DB restored without the FTS
// table, or a fresh trigram index after an upgrade). Safe to call on every boot.
func (s *Service) BackfillSearch(ctx context.Context) (int, error) {
	total, err := s.store.Count(ctx)
	if err != nil || total == 0 {
		return 0, err
	}
	if n, err := s.store.SearchCount(ctx); err != nil {
		return 0, err
	} else if n > 0 {
		return 0, nil
	}
	page, err := s.store.List(ctx, ListOptions{Limit: 200})
	if err != nil {
		return 0, err
	}
	bodies := make(map[string]string, len(page.Items))
	names := make(map[string][]string, len(page.Items))
	for {
		for _, item := range page.Items {
			detail, err := s.store.Get(ctx, item.Slug)
			if err != nil {
				continue
			}
			body, _ := s.tree.ReadBody(item.Slug)
			bodies[item.Slug] = body
			for _, file := range detail.Files {
				names[item.Slug] = append(names[item.Slug], file.Name)
			}
		}
		if !page.HasMore || page.Next == "" {
			break
		}
		page, err = s.store.List(ctx, ListOptions{Limit: 200, Cursor: page.Next})
		if err != nil {
			return 0, err
		}
	}
	if err := s.store.IndexAll(ctx, bodies, names); err != nil {
		return 0, err
	}
	return len(bodies), nil
}

// Raw is the download path: never counted as a view, never allowed to consume a burn paste.
func (s *Service) Raw(ctx context.Context, slug string) (string, string, error) {
	p, err := s.store.Get(ctx, slug)
	if err != nil {
		return "", "", err
	}
	if p.Burn {
		return "", "", ErrBurnNeeded
	}
	text, err := s.tree.ReadBody(slug)
	if err != nil {
		return "", "", fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return text, p.Language, nil
}

// File opens one attachment for streaming. The caller closes it.
func (s *Service) File(ctx context.Context, slug string, publicID string) (*os.File, File, error) {
	p, err := s.store.Get(ctx, slug)
	if err != nil {
		return nil, File{}, err
	}
	if p.Burn {
		return nil, File{}, ErrBurnNeeded
	}
	for _, file := range p.Files {
		if file.PublicID != publicID {
			continue
		}
		handle, err := s.tree.Open(slug, file.Rel)
		if err != nil {
			return nil, File{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
		}
		return handle, file, nil
	}
	return nil, File{}, ErrNotFound
}

func (s *Service) Get(ctx context.Context, slug string, countView bool) (*Paste, error) {
	p, err := s.store.Get(ctx, slug)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			if burned, _ := s.store.WasBurned(ctx, slug); burned {
				return nil, ErrGone
			}
		}
		return nil, err
	}
	if p.Burn {
		// A burn paste has no readable detail; only /reveal hands it over.
		return nil, ErrBurnNeeded
	}
	text, err := s.tree.ReadBody(slug)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	p.Text = text
	if countView {
		if err := s.store.IncrementViews(ctx, slug); err != nil {
			s.log.Warn("increment views", "slug", slug, "err", err)
		}
		p.Views++
	}
	return p, nil
}

// Resolve is the only read path the public host has. A slug that is not public is indistinguishable
// from one that does not exist: both are ErrNotFound, and the caller turns both into 404.
func (s *Service) Resolve(ctx context.Context, slug string, spec PublicSpec) (*Paste, error) {
	p, err := s.store.Get(ctx, slug)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			if burned, _ := s.store.WasBurned(ctx, slug); burned {
				return nil, ErrGone
			}
		}
		return nil, err
	}
	if p.Visibility != VisibilityPublic {
		return nil, ErrNotFound
	}
	if p.ExpiresAt != nil && *p.ExpiresAt <= stamp() {
		return nil, ErrGone
	}
	bucket := stamp() / 3600
	seen, err := s.store.SawView(ctx, slug, bucket, spec.IP)
	if err != nil {
		s.log.Warn("view lookup", "slug", slug, "err", err)
	}
	if p.MaxViews != nil && p.Views >= *p.MaxViews && !seen {
		return nil, ErrGone
	}
	if p.PasswordHash != "" && !spec.Unlocked {
		// Nothing but the fact that a record exists: no title, no size, no files.
		return &Paste{Slug: p.Slug, Visibility: p.Visibility, Locked: true}, ErrLocked
	}
	text, err := s.tree.ReadBody(slug)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	p.Text = text
	if fresh, err := s.store.RecordView(ctx, slug, bucket, spec.IP); err == nil && fresh {
		if err := s.store.IncrementViews(ctx, slug); err != nil {
			s.log.Warn("increment views", "slug", slug, "err", err)
		}
		p.Views++
	}
	return p, nil
}

// Unlock verifies the password for a public paste. Signing the cookie is the HTTP layer's job: the
// secret is configuration, not domain.
func (s *Service) Unlock(ctx context.Context, slug, password string) error {
	p, err := s.store.Get(ctx, slug)
	if err != nil {
		return err
	}
	if p.Visibility != VisibilityPublic || p.ExpiresAt != nil && *p.ExpiresAt <= stamp() {
		return ErrNotFound
	}
	if p.PasswordHash == "" {
		return ErrInvalid
	}
	if !VerifyPassword(p.PasswordHash, password) {
		return ErrLocked
	}
	return nil
}

func (s *Service) Create(ctx context.Context, in CreateInput) (*Paste, error) {
	text := in.Text
	if int64(len(text)) > s.limits.Text {
		return nil, ErrTextTooBig
	}
	total := int64(len(text))
	for _, file := range in.Files {
		total += file.Size
	}
	if total > s.limits.Paste {
		return nil, ErrTooLarge
	}
	if in.Burn && total > s.limits.Burn {
		return nil, ErrTooLarge
	}

	now := stamp()
	p := &Paste{
		Language:  normalizeLanguage(in.Language, text, in.Files),
		TextBytes: int64(len(text)),
		Burn:      in.Burn,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if in.ExpiresIn > 0 {
		expires := now + in.ExpiresIn
		p.ExpiresAt = &expires
	}
	p.Text = text
	if err := applyAccess(p, in.Visibility, in.Password, false, in.MaxViews, in.ExpiresIn); err != nil {
		return nil, err
	}

	files, err := s.planFiles(in.Files, nil)
	if err != nil {
		return nil, err
	}
	for index := range files {
		files[index].PublicID = NewPublicID()
	}
	p.Title = titleOr(in.Title, text, files)
	p.Kind = KindOf(text, files)
	p.FileCount = len(files)
	for _, file := range files {
		p.FileBytes += file.Size
	}

	var lastErr error
	for attempt := 0; attempt < 5; attempt++ {
		p.Slug = NewSlug()
		if err := s.tree.Prepare(p.Slug); err != nil {
			return nil, err
		}
		if text != "" {
			if err := s.tree.WriteBody(p.Slug, text); err != nil {
				s.tree.Remove(p.Slug)
				return nil, err
			}
		}
		if err := s.placeAll(p.Slug, in.Files, files); err != nil {
			s.tree.Remove(p.Slug)
			return nil, err
		}
		if err := s.store.Create(ctx, p, files); err != nil {
			s.tree.Remove(p.Slug)
			if isUnique(err) {
				lastErr = err
				continue
			}
			return nil, err
		}
		lastErr = nil
		break
	}
	if lastErr != nil {
		return nil, lastErr
	}

	p.Text = text
	p.Files = files
	s.publish("paste.created", p)
	return p, nil
}

func (s *Service) Update(ctx context.Context, slug string, in UpdateInput) (*Paste, error) {
	current, err := s.store.Get(ctx, slug)
	if err != nil {
		return nil, err
	}
	text := in.Text
	if int64(len(text)) > s.limits.Text {
		return nil, ErrTextTooBig
	}

	keep := make(map[string]File, len(current.Files))
	for _, file := range current.Files {
		keep[file.PublicID] = file
	}
	kept := make([]File, 0, len(in.Keep))
	for _, id := range in.Keep {
		if file, ok := keep[id]; ok {
			kept = append(kept, file)
		}
	}

	total := int64(len(text))
	for _, file := range kept {
		total += file.Size
	}
	for _, file := range in.Files {
		total += file.Size
	}
	if total > s.limits.Paste {
		return nil, ErrTooLarge
	}
	if in.Burn && total > s.limits.Burn {
		return nil, ErrTooLarge
	}

	added, err := s.planFiles(in.Files, kept)
	if err != nil {
		return nil, err
	}
	files := append(kept, added...)
	for index := range files {
		files[index].Sort = index
	}

	now := stamp()
	p := &Paste{
		ID:        current.ID,
		Slug:      slug,
		Text:      text,
		Title:     titleOr(in.Title, text, files),
		Language:  normalizeLanguage(in.Language, text, in.Files),
		Kind:      KindOf(text, files),
		TextBytes: int64(len(text)),
		FileCount: len(files),
		Burn:      in.Burn,
		CreatedAt: current.CreatedAt,
		UpdatedAt: now,
	}
	if in.ExpiresIn > 0 {
		expires := now + in.ExpiresIn
		p.ExpiresAt = &expires
	}
	for _, file := range files {
		p.FileBytes += file.Size
	}
	p.PasswordHash = current.PasswordHash
	p.MaxViews = current.MaxViews
	if err := applyAccess(p, in.Visibility, in.Password, in.ClearPassword, in.MaxViews, in.ExpiresIn); err != nil {
		return nil, err
	}

	if err := s.tree.Prepare(slug); err != nil {
		return nil, err
	}
	if text != "" {
		if err := s.tree.WriteBody(slug, text); err != nil {
			return nil, err
		}
	} else {
		_ = os.Remove(s.tree.BodyPath(slug))
	}
	if err := s.placeAll(slug, in.Files, added); err != nil {
		return nil, err
	}

	keptIDs := make(map[int64]bool, len(kept))
	for _, file := range kept {
		keptIDs[file.ID] = true
	}
	removed := make([]string, 0)
	for _, file := range current.Files {
		if !keptIDs[file.ID] {
			removed = append(removed, file.Rel)
		}
	}

	if err := s.store.Update(ctx, p, files); err != nil {
		return nil, err
	}
	for _, rel := range removed {
		_ = os.Remove(joinRel(s.tree.Dir(slug), rel))
	}

	p.Text = text
	p.Files = files
	s.publish("paste.updated", p)
	return p, nil
}

func (s *Service) Delete(ctx context.Context, slug string) error {
	if err := s.store.Delete(ctx, slug); err != nil {
		return err
	}
	if err := s.tree.Remove(slug); err != nil {
		s.log.Warn("remove tree", "slug", slug, "err", err)
	}
	s.publish("paste.deleted", &Paste{Slug: slug})
	return nil
}

func (s *Service) Purge(ctx context.Context) (int, error) {
	slugs, err := s.store.Purge(ctx)
	if err != nil {
		return 0, err
	}
	for _, slug := range slugs {
		if err := s.tree.Remove(slug); err != nil {
			s.log.Warn("remove tree", "slug", slug, "err", err)
		}
	}
	s.events.Publish(Event{Type: "paste.purged", At: stamp()})
	return len(slugs), nil
}

func (s *Service) Reveal(ctx context.Context, slug string) (*Reveal, error) {
	p, err := s.store.Get(ctx, slug)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			if burned, _ := s.store.WasBurned(ctx, slug); burned {
				return nil, ErrGone
			}
		}
		return nil, err
	}
	if !p.Burn {
		return nil, ErrBurnNeeded
	}

	text, err := s.tree.ReadBody(slug)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	out := &Reveal{Title: p.Title, Text: text, Language: p.Language, Files: []RevealFile{}}
	for _, file := range p.Files {
		raw, err := s.tree.Read(slug, file.Rel)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
		}
		out.Files = append(out.Files, RevealFile{
			Name: file.Name,
			Mime: file.Mime,
			Data: base64.StdEncoding.EncodeToString(raw),
		})
	}

	if err := s.store.Delete(ctx, slug); err != nil {
		return nil, err
	}
	if err := s.tree.Remove(slug); err != nil {
		s.log.Warn("remove burned tree", "slug", slug, "err", err)
	}
	if err := s.store.MarkBurned(ctx, slug, stamp()); err != nil {
		s.log.Warn("mark burned", "slug", slug, "err", err)
	}
	s.publish("paste.deleted", &Paste{Slug: slug})
	return out, nil
}

func (s *Service) Sweep(ctx context.Context, now int64) {
	slugs, err := s.store.Expired(ctx, now)
	if err != nil {
		s.log.Warn("expiry query", "err", err)
		return
	}
	for _, slug := range slugs {
		if err := s.store.Delete(ctx, slug); err != nil {
			if !errors.Is(err, ErrNotFound) {
				s.log.Warn("expire delete", "slug", slug, "err", err)
			}
			continue
		}
		_ = s.tree.Remove(slug)
		s.publish("paste.deleted", &Paste{Slug: slug})
	}
	if len(slugs) > 0 {
		s.log.Info("expired pastes", "count", len(slugs))
	}
}

type ReconcileResult struct {
	OrphanDirs  int
	MissingDirs int
}

func (s *Service) Reconcile(ctx context.Context) (ReconcileResult, error) {
	var result ReconcileResult
	page, err := s.store.List(ctx, ListOptions{Limit: 200})
	if err != nil {
		return result, err
	}
	rows := page.Items
	known := make(map[string]bool, len(rows))
	for _, row := range rows {
		known[row.Slug] = true
		if _, err := os.Stat(s.tree.Dir(row.Slug)); errors.Is(err, os.ErrNotExist) {
			if err := s.store.Delete(ctx, row.Slug); err != nil {
				s.log.Warn("drop row without tree", "slug", row.Slug, "err", err)
			} else {
				result.MissingDirs++
			}
		}
	}
	dirs, err := s.tree.Slugs()
	if err != nil {
		return result, err
	}
	for _, dir := range dirs {
		if known[dir] {
			continue
		}
		if err := s.tree.Remove(dir); err != nil {
			s.log.Warn("remove orphan dir", "slug", dir, "err", err)
			continue
		}
		result.OrphanDirs++
	}
	return result, nil
}

func (s *Service) planFiles(in []Incoming, kept []File) ([]File, error) {
	out := make([]File, 0, len(in))
	start := len(kept)
	for index, file := range in {
		if file.Size > s.limits.File {
			return nil, ErrTooLarge
		}
		name := SafeName(file.Name)
		out = append(out, File{
			Name: name,
			Mime: normalizeMime(file.Mime, name),
			Size: file.Size,
			Rel:  fmt.Sprintf("files/%d-%s", start+index+1, name),
			Sort: start + index,
		})
	}
	return out, nil
}

func (s *Service) placeAll(slug string, in []Incoming, planned []File) error {
	if len(in) != len(planned) {
		return errors.New("file plan mismatch")
	}
	for index, file := range in {
		if err := s.tree.Place(slug, planned[index].Rel, file.TempPath); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) publish(kind string, p *Paste) {
	row := *p
	row.Text = ""
	row.Files = nil
	s.events.Publish(Event{Type: kind, Slug: p.Slug, At: stamp(), Paste: &row})
}

func normalizeLanguage(language, text string, files []Incoming) string {
	if language == "" || language == "auto" {
		if len(files) > 0 && strings.TrimSpace(text) == "" {
			return "text"
		}
		return DetectLanguage(text, first(files))
	}
	return language
}

func normalizeMime(mime, name string) string {
	if mime == "" || mime == "application/octet-stream" {
		return mimeByExt(name)
	}
	return mime
}

func first(files []Incoming) string {
	if len(files) == 0 {
		return ""
	}
	return files[0].Name
}

func truncate(value string, max int) string {
	value = strings.TrimSpace(value)
	if len(value) <= max {
		return value
	}
	return value[:max]
}

func joinRel(dir, rel string) string {
	return dir + string(os.PathSeparator) + strings.ReplaceAll(rel, "/", string(os.PathSeparator))
}

func isUnique(err error) bool {
	return strings.Contains(err.Error(), "UNIQUE")
}

// titleOr keeps a user title, otherwise derives one. The 200-char cap protects the UI, not the DB.
func titleOr(raw, text string, files []File) string {
	if trimmed := strings.TrimSpace(raw); trimmed != "" {
		return truncate(trimmed, 200)
	}
	return truncate(DeriveTitle(text, files), 200)
}

// NewPublicID is the URL identity of a file. Same alphabet as a slug: no 0/O/1/I.
func NewPublicID() string {
	const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		for i := range buf {
			buf[i] = byte(time.Now().UnixNano() % 31)
		}
	}
	for i, b := range buf {
		buf[i] = alphabet[int(b)%len(alphabet)]
	}
	return string(buf)
}
