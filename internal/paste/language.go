package paste

import (
	"encoding/json"
	"path/filepath"
	"strings"
)

var extLanguage = map[string]string{
	"ts": "typescript", "tsx": "typescript", "mts": "typescript",
	"js": "javascript", "jsx": "javascript", "mjs": "javascript",
	"py": "python", "go": "go", "json": "json",
	"html": "html", "htm": "html",
	"sh": "shell", "bash": "shell", "zsh": "shell",
	"txt": "text", "md": "text",
}

// DetectLanguage is the server's copy of the client's heuristic: the browser sends a concrete
// language, but the API must not store "auto".
func DetectLanguage(text, filename string) string {
	if filename != "" {
		ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(filename)), ".")
		if language, ok := extLanguage[ext]; ok {
			return language
		}
	}
	head := strings.TrimSpace(text)
	if head == "" {
		return "text"
	}
	if len(head) > 4000 {
		head = head[:4000]
	}
	if strings.HasPrefix(head, "#!") {
		if strings.Contains(head, "python") {
			return "python"
		}
		return "shell"
	}
	if strings.HasPrefix(head, "{") || strings.HasPrefix(head, "[") {
		var value any
		if json.Unmarshal([]byte(text), &value) == nil {
			return "json"
		}
	}
	lower := strings.ToLower(head)
	switch {
	case strings.HasPrefix(lower, "<!doctype html"), strings.HasPrefix(lower, "<html"),
		strings.HasPrefix(lower, "<div"), strings.HasPrefix(lower, "<section"):
		return "html"
	case strings.Contains(head, "package "), strings.Contains(head, "func "),
		strings.Contains(head, "type ") && strings.Contains(head, "struct"):
		return "go"
	case strings.Contains(head, "def "), strings.Contains(head, "import "),
		strings.Contains(head, "class "):
		return "python"
	case strings.Contains(head, "interface "), strings.Contains(head, "=>"),
		strings.Contains(head, ": string"), strings.Contains(head, ": number"):
		return "typescript"
	case strings.Contains(head, "function "), strings.Contains(head, "const "),
		strings.Contains(head, "let "):
		return "javascript"
	}
	return "text"
}

var extMime = map[string]string{
	"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
	"webp": "image/webp", "svg": "image/svg+xml",
	"pdf": "application/pdf", "zip": "application/zip",
	"txt": "text/plain; charset=utf-8", "md": "text/markdown; charset=utf-8",
	"json": "application/json", "csv": "text/csv; charset=utf-8",
}

func mimeByExt(name string) string {
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), ".")
	if mime, ok := extMime[ext]; ok {
		return mime
	}
	return "application/octet-stream"
}
