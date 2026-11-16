package paste

import "testing"

func TestNewSlugShape(t *testing.T) {
	seen := make(map[string]bool, 10_000)
	for i := 0; i < 10_000; i++ {
		slug := NewSlug()
		if len(slug) != 8 {
			t.Fatalf("length %d for %q", len(slug), slug)
		}
		if !ValidateSlug(slug) {
			t.Fatalf("alphabet violation: %q", slug)
		}
		if seen[slug] {
			t.Fatalf("collision after %d draws: %q", i, slug)
		}
		seen[slug] = true
	}
}

func TestValidateSlugRejectsPaths(t *testing.T) {
	for _, bad := range []string{"", "short", "../../etc/passwd", "abcdefgh", "ABCDEFG0", "ABCDEFG1"} {
		if ValidateSlug(bad) {
			t.Fatalf("accepted %q", bad)
		}
	}
}

func TestKindOf(t *testing.T) {
	cases := []struct {
		text  string
		files []File
		want  string
	}{
		{"hello", nil, "text"},
		{"", []File{{Mime: "image/png"}}, "images"},
		{"", []File{{Mime: "application/pdf"}}, "files"},
		{"", []File{{Mime: "image/png"}, {Mime: "application/pdf"}}, "files"},
		{"hello", []File{{Mime: "image/png"}}, "mixed"},
	}
	for _, c := range cases {
		if got := KindOf(c.text, c.files); got != c.want {
			t.Fatalf("KindOf(%q, %v) = %q, want %q", c.text, c.files, got, c.want)
		}
	}
}
