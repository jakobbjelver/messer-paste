package paste

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
)

type nopPublisher struct{}

func (nopPublisher) Publish(Event) {}

// updateFailingStore is a Store whose write always fails. Update places the uploaded bytes before it
// writes the rows, so this is the state that turned a 500 into a stranded attachment on disk.
type updateFailingStore struct {
	Store
	current *Paste
}

func (s updateFailingStore) Get(context.Context, string) (*Paste, error) { return s.current, nil }

func (updateFailingStore) Update(context.Context, *Paste, []File) error { return errors.New("boom") }

func TestFailedUpdateLeavesNoFilesBehind(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	tree, err := NewStorage(root)
	if err != nil {
		t.Fatal(err)
	}
	svc := NewService(updateFailingStore{current: &Paste{ID: 1, Slug: "ABCDEFGH", CreatedAt: 1}},
		tree, Limits{Text: 1 << 20, File: 1 << 20, Paste: 4 << 20, Burn: 1 << 20},
		nopPublisher{}, slog.New(slog.DiscardHandler))

	staged := filepath.Join(root, ".tmp", "upload.txt")
	if err := os.MkdirAll(filepath.Dir(staged), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(staged, []byte("bytes"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err = svc.Update(ctx, "ABCDEFGH", UpdateInput{
		Text:      "a note",
		AutoTitle: boolPtr(true),
		Files:     []Incoming{{Name: "upload.txt", Mime: "text/plain", TempPath: staged, Size: 5}},
	})
	if err == nil {
		t.Fatal("update should have failed")
	}

	entries, err := os.ReadDir(filepath.Join(root, "ABCDEFGH", "files"))
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("failed update left %d file(s) behind: %v", len(entries), entries)
	}
}

func boolPtr(value bool) *bool { return &value }
