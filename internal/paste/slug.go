package paste

import (
	"crypto/rand"
	"regexp"
)

// The alphabet drops 0/O/1/I: a slug gets read aloud, typed by hand and printed in a mono eyebrow.
const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

var slugRe = regexp.MustCompile(`^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$`)

// NewSlug returns 8 characters. 256 is a multiple of 32, so byte%32 is uniform.
func NewSlug() string {
	raw := make([]byte, 8)
	if _, err := rand.Read(raw); err != nil {
		panic(err) // the OS entropy source is gone; nothing sane to do
	}
	out := make([]byte, 8)
	for i, b := range raw {
		out[i] = alphabet[int(b)%len(alphabet)]
	}
	return string(out)
}

func ValidateSlug(slug string) bool { return slugRe.MatchString(slug) }
