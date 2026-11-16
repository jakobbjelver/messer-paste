package store

import (
	"context"
	"testing"

	"github.com/jakobbjelver/messer-paste/internal/paste"
)

func open(t *testing.T) *Store {
	t.Helper()
	st, err := Open(t.TempDir() + "/state.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func TestCRUD(t *testing.T) {
	ctx := context.Background()
	st := open(t)

	p := &paste.Paste{
		Slug: "ABCDEFGH", Title: "hello", Language: "text", Kind: "text",
		TextBytes: 5, FileBytes: 5, FileCount: 1, CreatedAt: 10, UpdatedAt: 10,
	}
	files := []paste.File{{Name: "a.txt", Mime: "text/plain", Size: 5, Rel: "files/1-a.txt", Sort: 0}}
	if err := st.Create(ctx, p, files); err != nil {
		t.Fatal(err)
	}
	if p.ID == 0 || files[0].ID == 0 {
		t.Fatalf("ids not assigned: paste=%d file=%d", p.ID, files[0].ID)
	}

	got, err := st.Get(ctx, "ABCDEFGH")
	if err != nil {
		t.Fatal(err)
	}
	if got.FileCount != 1 || len(got.Files) != 1 || got.Files[0].Name != "a.txt" {
		t.Fatalf("bad read: %+v", got)
	}

	if err := st.IncrementViews(ctx, "ABCDEFGH"); err != nil {
		t.Fatal(err)
	}
	got, _ = st.Get(ctx, "ABCDEFGH")
	if got.Views != 1 {
		t.Fatalf("views = %d", got.Views)
	}

	rows, err := st.List(ctx)
	if err != nil || len(rows) != 1 {
		t.Fatalf("list = %v, %v", rows, err)
	}

	got.Title = "edited"
	got.UpdatedAt = 20
	if err := st.Update(ctx, got, got.Files); err != nil {
		t.Fatal(err)
	}
	got, _ = st.Get(ctx, "ABCDEFGH")
	if got.Title != "edited" {
		t.Fatalf("title = %q", got.Title)
	}

	if err := st.Delete(ctx, "ABCDEFGH"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Get(ctx, "ABCDEFGH"); err != paste.ErrNotFound {
		t.Fatalf("expected not found, got %v", err)
	}
}

func TestPurgeAndExpiry(t *testing.T) {
	ctx := context.Background()
	st := open(t)
	now := int64(1000)
	expired := int64(900)
	for _, p := range []*paste.Paste{
		{Slug: "AAAAAAAA", Kind: "text", CreatedAt: now, UpdatedAt: now},
		{Slug: "BBBBBBBB", Kind: "text", CreatedAt: now, UpdatedAt: now, ExpiresAt: &expired},
	} {
		if err := st.Create(ctx, p, nil); err != nil {
			t.Fatal(err)
		}
	}
	slugs, err := st.Expired(ctx, now)
	if err != nil || len(slugs) != 1 || slugs[0] != "BBBBBBBB" {
		t.Fatalf("expired = %v, %v", slugs, err)
	}
	purged, err := st.Purge(ctx)
	if err != nil || len(purged) != 2 {
		t.Fatalf("purge = %v, %v", purged, err)
	}
	n, _ := st.Count(ctx)
	if n != 0 {
		t.Fatalf("count after purge = %d", n)
	}
}

func TestBurnTombstone(t *testing.T) {
	ctx := context.Background()
	st := open(t)
	if err := st.MarkBurned(ctx, "CCCCCCCC", 42); err != nil {
		t.Fatal(err)
	}
	burned, err := st.WasBurned(ctx, "CCCCCCCC")
	if err != nil || !burned {
		t.Fatalf("wasBurned = %v, %v", burned, err)
	}
	if burned, _ := st.WasBurned(ctx, "DDDDDDDD"); burned {
		t.Fatal("unrelated slug reported burned")
	}
}
