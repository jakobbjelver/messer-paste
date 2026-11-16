package paste

import (
	"strings"
	"testing"
)

func TestDeriveTitle(t *testing.T) {
	cases := []struct {
		name  string
		text  string
		files []File
		want  string
	}{
		{"plain", "hello world", nil, "hello world"},
		{"markdown", "## deploy log\nbody", nil, "deploy log"},
		{"quote", "\n\n> quoted text", nil, "quoted text"},
		{"list", "- item one\n- item two", nil, "item one"},
		{"backtick", "```go\nfunc main()", nil, "go"},
		{"empty text", "", nil, "Untitled paste"},
		{"one file", "", []File{{Name: "report.pdf", Mime: "application/pdf"}}, "report.pdf"},
		{"two images", "", []File{{Name: "a.png", Mime: "image/png"}, {Name: "b.png", Mime: "image/png"}}, "2 images"},
		{"image and file", "", []File{{Name: "a.png", Mime: "image/png"}, {Name: "b.pdf", Mime: "application/pdf"}}, "1 image, 1 file"},
		{"text and image", "crash loop", []File{{Name: "a.png", Mime: "image/png"}}, "crash loop + 1 image"},
		{"text and two files", "build log", []File{{Name: "a.txt", Mime: "text/plain"}, {Name: "b.txt", Mime: "text/plain"}}, "build log + 2 files"},
	}
	for _, c := range cases {
		if got := DeriveTitle(c.text, c.files); got != c.want {
			t.Errorf("%s: DeriveTitle = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestDeriveTitleClip(t *testing.T) {
	long := ""
	for i := 0; i < 30; i++ {
		long += "word "
	}
	got := DeriveTitle(long, nil)
	if len([]rune(got)) > 66 || !strings.HasSuffix(got, "…") {
		t.Fatalf("clip = %q", got)
	}
}
