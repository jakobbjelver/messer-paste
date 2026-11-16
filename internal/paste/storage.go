package paste

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

// Storage is the content tree: one directory per paste, removed with it. It never trusts a name
// that arrived in a request.
type Storage struct {
	root string
}

func NewStorage(root string) (*Storage, error) {
	if err := os.MkdirAll(filepath.Join(root, ".tmp"), 0o755); err != nil {
		return nil, err
	}
	return &Storage{root: root}, nil
}

func (s *Storage) Root() string { return s.root }

func (s *Storage) Dir(slug string) string { return filepath.Join(s.root, slug) }

func (s *Storage) BodyPath(slug string) string { return filepath.Join(s.Dir(slug), "body.txt") }

// TempDir is inside the content root so the final move is a rename on the same filesystem.
func (s *Storage) TempDir() (string, error) {
	raw := make([]byte, 8)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	dir := filepath.Join(s.root, ".tmp", hex.EncodeToString(raw))
	return dir, os.MkdirAll(dir, 0o755)
}

func (s *Storage) Prepare(slug string) error {
	return os.MkdirAll(filepath.Join(s.Dir(slug), "files"), 0o755)
}

func (s *Storage) WriteBody(slug, text string) error {
	return os.WriteFile(s.BodyPath(slug), []byte(text), 0o644)
}

func (s *Storage) ReadBody(slug string) (string, error) {
	raw, err := os.ReadFile(s.BodyPath(slug))
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// Place copies a staged upload into the paste directory. Staging and the tree are the same volume,
// but a copy keeps the code honest if they are not.
func (s *Storage) Place(slug, rel, source string) error {
	dst := filepath.Join(s.Dir(slug), filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func (s *Storage) Read(slug, rel string) ([]byte, error) {
	return os.ReadFile(filepath.Join(s.Dir(slug), filepath.FromSlash(rel)))
}

func (s *Storage) Open(slug, rel string) (*os.File, error) {
	return os.Open(filepath.Join(s.Dir(slug), filepath.FromSlash(rel)))
}

func (s *Storage) Remove(slug string) error {
	if !ValidateSlug(slug) {
		return ErrNotFound
	}
	err := os.RemoveAll(s.Dir(slug))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

// Slugs lists paste directories, ignoring the staging dir.
func (s *Storage) Slugs() ([]string, error) {
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || entry.Name() == ".tmp" {
			continue
		}
		if ValidateSlug(entry.Name()) {
			out = append(out, entry.Name())
		}
	}
	return out, nil
}

// SafeName keeps the display name but never a path: base, no control characters, 200 bytes.
func SafeName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if r == 0 || unicode.IsControl(r) {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	name = strings.Trim(name, ".")
	if name == "" {
		name = "file"
	}
	if len(name) > 200 {
		name = name[:200]
	}
	return name
}
