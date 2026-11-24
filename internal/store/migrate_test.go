package store_test

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"

	"github.com/jakobbjelver/messer-paste/internal/paste"
	"github.com/jakobbjelver/messer-paste/internal/store"
)

// A v0.2 database has no visibility column. Opening it must add the columns and default to private,
// not crash — that ordering bug took production down once.
func TestOpenMigratesVisibilityColumns(t *testing.T) {
	path := t.TempDir() + "/old.db"
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`
		CREATE TABLE pastes (
		  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL DEFAULT '',
		  language TEXT NOT NULL DEFAULT 'text', kind TEXT NOT NULL,
		  text_bytes INTEGER NOT NULL DEFAULT 0, file_bytes INTEGER NOT NULL DEFAULT 0,
		  file_count INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0,
		  burn INTEGER NOT NULL DEFAULT 0, expires_at INTEGER,
		  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
		INSERT INTO pastes (slug, kind, created_at, updated_at) VALUES ('AAAA2345', 'text', 1, 1);
	`); err != nil {
		t.Fatal(err)
	}
	raw.Close()

	st, err := store.Open(path)
	if err != nil {
		t.Fatalf("open an old schema: %v", err)
	}
	defer st.Close()

	p, err := st.Get(t.Context(), "AAAA2345")
	if err != nil {
		t.Fatalf("read after migrate: %v", err)
	}
	if p.Visibility != paste.VisibilityPrivate {
		t.Fatalf("visibility after migrate = %q, want private", p.Visibility)
	}
}

// A v0.4 files table has no width/height/thumbs. The reader needs them the moment the binary
// changes, so opening it must add all three with defaults a client can ignore.
func TestOpenMigratesPhotoColumns(t *testing.T) {
	path := t.TempDir() + "/old.db"
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`
		CREATE TABLE pastes (
		  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL DEFAULT '',
		  language TEXT NOT NULL DEFAULT 'text', kind TEXT NOT NULL,
		  text_bytes INTEGER NOT NULL DEFAULT 0, file_bytes INTEGER NOT NULL DEFAULT 0,
		  file_count INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0,
		  burn INTEGER NOT NULL DEFAULT 0, expires_at INTEGER,
		  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
		CREATE TABLE files (
		  id INTEGER PRIMARY KEY, paste_id INTEGER NOT NULL, public_id TEXT NOT NULL DEFAULT '',
		  name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, rel TEXT NOT NULL,
		  sort INTEGER NOT NULL);
		INSERT INTO pastes (id, slug, kind, file_count, created_at, updated_at)
		  VALUES (1, 'AAAA2345', 'images', 1, 1, 1);
		INSERT INTO files (paste_id, public_id, name, mime, size, rel, sort)
		  VALUES (1, 'BBBB2345', 'photo.jpg', 'image/jpeg', 4096, 'files/1-photo.jpg', 0);
	`); err != nil {
		t.Fatal(err)
	}
	raw.Close()

	st, err := store.Open(path)
	if err != nil {
		t.Fatalf("open an old schema: %v", err)
	}
	defer st.Close()

	p, err := st.Get(t.Context(), "AAAA2345")
	if err != nil {
		t.Fatalf("read after migrate: %v", err)
	}
	if len(p.Files) != 1 {
		t.Fatalf("files = %d, want 1", len(p.Files))
	}
	file := p.Files[0]
	if file.Width != 0 || file.Height != 0 || file.Thumbs != nil {
		t.Fatalf("a pre-photo row must read as unmeasured, got %d×%d %v", file.Width, file.Height, file.Thumbs)
	}

	// And the columns are writable, which is the whole point of the backfill.
	if err := st.SetFileMeta(t.Context(), file.ID, 4284, 5712, []int{1024, 2048}); err != nil {
		t.Fatalf("set file meta: %v", err)
	}
	again, err := st.Get(t.Context(), "AAAA2345")
	if err != nil {
		t.Fatal(err)
	}
	if got := again.Files[0]; got.Width != 4284 || got.Height != 5712 || len(got.Thumbs) != 2 {
		t.Fatalf("after backfill = %d×%d %v", got.Width, got.Height, got.Thumbs)
	}
}
