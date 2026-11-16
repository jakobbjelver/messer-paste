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
