// Package web serves the built React app from app/dist. The binary embeds it, so a deploy is one
// image and the SPA needs no separate container or CDN.
//
// A missing frontend answers 503 on HTML routes and takes nothing else down with it.
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:app/dist
var dist embed.FS

// Handler serves the SPA at "/": real files when they exist, index.html for any other path so
// client routing survives a reload.
func Handler() http.Handler {
	sub, err := fs.Sub(dist, "app/dist")
	if err != nil {
		panic(err) // an embedded tree that cannot be addressed is a build defect
	}
	return handlerFor(sub)
}

func handlerFor(fsys fs.FS) http.Handler {
	files := http.FileServerFS(fsys)
	index, indexErr := fs.ReadFile(fsys, "index.html")

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := path.Clean(strings.TrimPrefix(r.URL.Path, "/"))

		if clean == "." || clean == "/" || strings.HasPrefix(clean, "..") {
			serveIndex(w, index, indexErr)
			return
		}
		if f, err := fsys.Open(clean); err == nil {
			_ = f.Close()
			switch {
			case strings.HasPrefix(clean, "assets/"):
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			case clean == "sw.js" || clean == "manifest.webmanifest":
				// Both must be re-read on every visit: a cached worker is a stale app, and a cached
				// manifest hides an icon or a start_url fix for a day.
				w.Header().Set("Cache-Control", "no-cache")
				if clean == "manifest.webmanifest" {
					w.Header().Set("Content-Type", "application/manifest+json")
				}
			}
			files.ServeHTTP(w, r)
			return
		}
		if path.Ext(clean) != "" {
			http.NotFound(w, r)
			return
		}
		serveIndex(w, index, indexErr)
	})
}

func serveIndex(w http.ResponseWriter, index []byte, indexErr error) {
	if indexErr != nil {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte("frontend not built: run `make web`\n"))
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(index)
}
