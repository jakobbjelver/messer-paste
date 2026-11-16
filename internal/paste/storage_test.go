package paste

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSafeName(t *testing.T) {
	cases := map[string]string{
		"../../etc/passwd": "passwd",
		"..\\..\\windows":  "windows",
		"a\x00b.txt":       "ab.txt",
		"  ..hidden..  ":   "hidden",
		"":                 "file",
	}
	for in, want := range cases {
		if got := SafeName(in); got != want {
			t.Fatalf("SafeName(%q) = %q, want %q", in, got, want)
		}
	}
	if got := SafeName(strings.Repeat("a", 300)); len(got) != 200 {
		t.Fatalf("long name kept %d bytes", len(got))
	}
}

func TestStoragePlaceAndRemove(t *testing.T) {
	root := t.TempDir()
	tree, err := NewStorage(root)
	if err != nil {
		t.Fatal(err)
	}
	staged := filepath.Join(t.TempDir(), "src")
	if err := os.WriteFile(staged, []byte("bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := tree.Prepare("ABCDEFGH"); err != nil {
		t.Fatal(err)
	}
	if err := tree.Place("ABCDEFGH", "files/1-src", staged); err != nil {
		t.Fatal(err)
	}
	raw, err := tree.Read("ABCDEFGH", "files/1-src")
	if err != nil || string(raw) != "bytes" {
		t.Fatalf("read = %q, %v", raw, err)
	}
	if err := tree.Remove("ABCDEFGH"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(tree.Dir("ABCDEFGH")); !os.IsNotExist(err) {
		t.Fatal("directory survived Remove")
	}
}
