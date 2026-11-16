package httpapi

import (
	"time"

	"github.com/jakobbjelver/messer-paste/internal/paste"
)

// The wire format is not the domain struct: timestamps are RFC 3339 UTC (the standard), and file
// ids are public ids, never the row's auto-increment.

type fileDTO struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Mime string `json:"mime"`
	Size int64  `json:"size"`
}

type matchDTO struct {
	Field   string `json:"field"`
	Snippet string `json:"snippet"`
}

type pasteDTO struct {
	Slug       string    `json:"slug"`
	Title      string    `json:"title"`
	Language   string    `json:"language"`
	Kind       string    `json:"kind"`
	TextBytes  int64     `json:"text_bytes"`
	FileBytes  int64     `json:"file_bytes"`
	FileCount  int       `json:"file_count"`
	Views      int64     `json:"views"`
	Burn       bool      `json:"burn"`
	Visibility string    `json:"visibility"`
	MaxViews   *int64    `json:"max_views"`
	Locked     bool      `json:"locked"`
	ExpiresAt  *string   `json:"expires_at"`
	CreatedAt  string    `json:"created_at"`
	UpdatedAt  string    `json:"updated_at"`
	Text       string    `json:"text,omitempty"`
	Files      []fileDTO `json:"files,omitempty"`
	Match      *matchDTO `json:"match,omitempty"`
}

type listDTO struct {
	Items      []pasteDTO `json:"items"`
	NextCursor string     `json:"next_cursor"`
	HasMore    bool       `json:"has_more"`
	Total      int        `json:"total"`
	TookMS     int64      `json:"took_ms"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type errorDTO struct {
	Error errorBody `json:"error"`
}

func stampDTO(unix int64) string {
	if unix == 0 {
		return ""
	}
	return time.Unix(unix, 0).UTC().Format(time.RFC3339)
}

func dtoPaste(p *paste.Paste) pasteDTO {
	out := pasteDTO{
		Slug:       p.Slug,
		Title:      p.Title,
		Language:   p.Language,
		Kind:       p.Kind,
		TextBytes:  p.TextBytes,
		FileBytes:  p.FileBytes,
		FileCount:  p.FileCount,
		Views:      p.Views,
		Burn:       p.Burn,
		Visibility: orPrivateVisibility(p.Visibility),
		MaxViews:   p.MaxViews,
		Locked:     p.Locked,
		CreatedAt:  stampDTO(p.CreatedAt),
		UpdatedAt:  stampDTO(p.UpdatedAt),
		Text:       p.Text,
	}
	if p.ExpiresAt != nil {
		value := stampDTO(*p.ExpiresAt)
		out.ExpiresAt = &value
	}
	if len(p.Files) > 0 {
		out.Files = make([]fileDTO, 0, len(p.Files))
		for _, file := range p.Files {
			out.Files = append(out.Files, fileDTO{ID: file.PublicID, Name: file.Name, Mime: file.Mime, Size: file.Size})
		}
	}
	if p.Match != nil {
		out.Match = &matchDTO{Field: p.Match.Field, Snippet: p.Match.Snippet}
	}
	return out
}

func dtoList(result paste.ListResult, took time.Duration) listDTO {
	items := make([]pasteDTO, 0, len(result.Items))
	for index := range result.Items {
		items = append(items, dtoPaste(&result.Items[index]))
	}
	return listDTO{
		Items:      items,
		NextCursor: result.Next,
		HasMore:    result.HasMore,
		Total:      result.Total,
		TookMS:     took.Milliseconds(),
	}
}

func orPrivateVisibility(value string) string {
	if value == "" {
		return paste.VisibilityPrivate
	}
	return value
}
