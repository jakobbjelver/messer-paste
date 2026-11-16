// Package paste owns the product: slugs, the content tree, the metadata rules and the events a
// change emits. The HTTP layer only parses requests and maps errors.
package paste

import (
	"errors"
	"strings"
	"time"
)

var (
	ErrNotFound    = errors.New("not_found")
	ErrGone        = errors.New("gone")
	ErrBurnNeeded  = errors.New("burn_required")
	ErrTooLarge    = errors.New("too_large")
	ErrTextTooBig  = errors.New("text_too_large")
	ErrUnavailable = errors.New("content_unavailable")
)

type Paste struct {
	ID        int64  `json:"-"`
	Slug      string `json:"slug"`
	Title     string `json:"title"`
	Language  string `json:"language"`
	Kind      string `json:"kind"`
	TextBytes int64  `json:"textBytes"`
	FileBytes int64  `json:"fileBytes"`
	FileCount int    `json:"fileCount"`
	Views     int64  `json:"views"`
	Burn      bool   `json:"burn"`
	ExpiresAt *int64 `json:"expiresAt"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
	Text      string `json:"text,omitempty"`
	Files     []File `json:"files,omitempty"`
}

type File struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Mime string `json:"mime"`
	Size int64  `json:"size"`
	Rel  string `json:"-"`
	Sort int    `json:"-"`
}

// KindOf is the one place the list's Kind column is decided.
func KindOf(text string, files []File) string {
	hasText := strings.TrimSpace(text) != ""
	if len(files) == 0 {
		return "text"
	}
	images := true
	for _, file := range files {
		if !strings.HasPrefix(file.Mime, "image/") {
			images = false
			break
		}
	}
	switch {
	case hasText:
		return "mixed"
	case images:
		return "images"
	default:
		return "files"
	}
}

type Event struct {
	ID    uint64 `json:"-"`
	Type  string `json:"type"`
	Slug  string `json:"slug,omitempty"`
	At    int64  `json:"at"`
	Paste *Paste `json:"paste,omitempty"`
}

type Publisher interface {
	Publish(Event)
}

func stamp() int64 { return time.Now().Unix() }
