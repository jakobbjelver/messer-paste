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
	ErrInvalid     = errors.New("invalid")
	ErrLocked      = errors.New("locked")
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
	// Visibility is "private" (the default, only reachable through the proxy) or "public" (readable on
	// the public host).
	Visibility   string `json:"visibility"`
	PasswordHash string `json:"-"`
	MaxViews     *int64 `json:"maxViews,omitempty"`
	Locked       bool   `json:"locked,omitempty"`
	Text         string `json:"text,omitempty"`
	Files        []File `json:"files,omitempty"`
	Match        *Match `json:"match,omitempty"`
}

type File struct {
	ID int64 `json:"-"`
	// PublicID is what URLs carry: an auto-increment id must never be the public identifier.
	PublicID string `json:"id"`
	Name     string `json:"name"`
	Mime     string `json:"mime"`
	Size     int64  `json:"size"`
	// Width and Height are the photo's size in the orientation it is meant to be seen in, read from
	// its header at upload. The reader reserves the box from them, so nothing moves when the pixels
	// arrive. Both are 0 for anything that is not a measurable image.
	Width  int `json:"width,omitempty"`
	Height int `json:"height,omitempty"`
	// Thumbs lists the derivative widths that exist for this file. A client builds its srcset from
	// this, never from the widths it wishes existed.
	Thumbs []int `json:"thumbs,omitempty"`

	Rel  string `json:"-"`
	Sort int    `json:"-"`
}

const (
	VisibilityPrivate = "private"
	VisibilityPublic  = "public"
)

// Match is what a search hit matched on, and the fragment around it. Only list responses carry it.
type Match struct {
	Field   string `json:"field"`
	Snippet string `json:"snippet"`
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

// ListOptions and ListResult are the archive contract: keyset pagination plus one search path.
type ListOptions struct {
	Query  string
	Limit  int
	Cursor string
}

type ListResult struct {
	Items   []Paste
	Next    string
	HasMore bool
	Total   int
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
