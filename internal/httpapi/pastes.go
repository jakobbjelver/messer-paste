package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/jakobbjelver/messer-paste/internal/paste"
)

func (s *Server) listPastes(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil {
			limit = value
		}
	}
	result, err := s.svc.List(r.Context(), paste.ListOptions{
		Query:  r.URL.Query().Get("q"),
		Limit:  limit,
		Cursor: r.URL.Query().Get("cursor"),
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, dtoList(result, time.Since(started)))
}

func (s *Server) getPaste(w http.ResponseWriter, r *http.Request) {
	p, err := s.svc.Get(r.Context(), slugOf(r), true)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, dtoPaste(p))
}

func (s *Server) createPaste(w http.ResponseWriter, r *http.Request) {
	key := r.Header.Get("Idempotency-Key")
	if body, found, err := s.store.Idempotent(r.Context(), key); err == nil && found {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Idempotent-Replay", "true")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write(body)
		return
	}
	fields, files, cleanup, err := s.parse(w, r)
	defer cleanup()
	if err != nil {
		s.fail(w, r, err)
		return
	}
	in := paste.CreateInput{
		Title:     fields["title"],
		Text:      fields["text"],
		Language:  fields["language"],
		ExpiresIn: expiresIn(fields["expires_in"]),
		Burn:      fields["burn"] == "1",
		Files:     files,
	}
	p, err := s.svc.Create(r.Context(), in)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	body, err := json.Marshal(dtoPaste(p))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	_ = s.store.SaveIdempotent(r.Context(), key, body)
	writeJSONBytes(w, http.StatusCreated, body)
}

func (s *Server) updatePaste(w http.ResponseWriter, r *http.Request) {
	slug := slugOf(r)
	fields, files, cleanup, err := s.parse(w, r)
	defer cleanup()
	if err != nil {
		s.fail(w, r, err)
		return
	}
	in := paste.UpdateInput{
		Title:     fields["title"],
		Text:      fields["text"],
		Language:  fields["language"],
		ExpiresIn: expiresIn(fields["expires_in"]),
		Burn:      fields["burn"] == "1",
		Files:     files,
	}
	for _, raw := range strings.Split(fields["keep"], ",") {
		raw = strings.TrimSpace(raw)
		if raw != "" {
			in.Keep = append(in.Keep, raw)
		}
	}
	p, err := s.svc.Update(r.Context(), slug, in)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, dtoPaste(p))
}

func (s *Server) deletePaste(w http.ResponseWriter, r *http.Request) {
	if err := s.svc.Delete(r.Context(), slugOf(r)); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) purgePastes(w http.ResponseWriter, r *http.Request) {
	n, err := s.svc.Purge(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"deleted": n})
}

func (s *Server) rawPaste(w http.ResponseWriter, r *http.Request) {
	text, _, err := s.svc.Raw(r.Context(), slugOf(r))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=60")
	_, _ = io.WriteString(w, text)
}

func (s *Server) filePaste(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusNotFound, "E_NOT_FOUND")
		return
	}
	handle, file, err := s.svc.File(r.Context(), slugOf(r), id)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	defer handle.Close()

	w.Header().Set("Content-Type", file.Mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=300")

	inline := inlineImage(file.Mime) && r.URL.Query().Get("download") != "1"
	if inline {
		w.Header().Set("Content-Disposition", "inline")
	} else {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": file.Name}))
	}
	http.ServeContent(w, r, file.Name, timeZero, handle)
}

func (s *Server) revealPaste(w http.ResponseWriter, r *http.Request) {
	out, err := s.svc.Reveal(r.Context(), slugOf(r))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// parse streams every part to a staging dir inside the content root. Fields are buffered (they are
// small), files are never held in memory.
func (s *Server) parse(w http.ResponseWriter, r *http.Request) (map[string]string, []paste.Incoming, func(), error) {
	noop := func() {}
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxPaste+(1<<20))

	reader, err := r.MultipartReader()
	if err != nil {
		return nil, nil, noop, errBadRequest
	}
	tmp, err := s.tree.TempDir()
	if err != nil {
		return nil, nil, noop, err
	}
	cleanup := func() { _ = os.RemoveAll(tmp) }

	fields := make(map[string]string, 8)
	var files []paste.Incoming
	var total int64

	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			cleanup()
			return nil, nil, noop, mapLimit(err)
		}

		if part.FileName() == "" {
			raw, err := io.ReadAll(io.LimitReader(part, s.cfg.MaxText+1))
			part.Close()
			if err != nil {
				cleanup()
				return nil, nil, noop, mapLimit(err)
			}
			name := part.FormName()
			if name == "keep" && fields[name] != "" {
				fields[name] += "," + string(raw)
			} else {
				fields[name] = string(raw)
			}
			continue
		}

		name := paste.SafeName(part.FileName())
		dst := filepath.Join(tmp, fmt.Sprintf("%d-%s", len(files), name))
		out, err := os.Create(dst)
		if err != nil {
			part.Close()
			cleanup()
			return nil, nil, noop, err
		}
		size, err := io.Copy(out, io.LimitReader(part, s.cfg.MaxFile+1))
		out.Close()
		part.Close()
		if err != nil {
			cleanup()
			return nil, nil, noop, mapLimit(err)
		}
		if size > s.cfg.MaxFile {
			cleanup()
			return nil, nil, noop, paste.ErrTooLarge
		}
		total += size
		if total > s.cfg.MaxPaste {
			cleanup()
			return nil, nil, noop, paste.ErrTooLarge
		}
		mimeType := strings.TrimSpace(part.Header.Get("Content-Type"))
		if mimeType == "" || mimeType == "application/octet-stream" {
			mimeType = sniff(dst)
		}
		files = append(files, paste.Incoming{Name: name, Mime: mimeType, TempPath: dst, Size: size})
	}

	if len(fields["text"]) > int(s.cfg.MaxText) {
		cleanup()
		return nil, nil, noop, paste.ErrTextTooBig
	}
	return fields, files, cleanup, nil
}

func mapLimit(err error) error {
	var limit *http.MaxBytesError
	if errors.As(err, &limit) {
		return paste.ErrTooLarge
	}
	return errBadRequest
}

func sniff(path string) string {
	handle, err := os.Open(path)
	if err != nil {
		return "application/octet-stream"
	}
	defer handle.Close()
	buffer := make([]byte, 512)
	n, _ := handle.Read(buffer)
	return http.DetectContentType(buffer[:n])
}

func inlineImage(mimeType string) bool {
	switch mimeType {
	case "image/png", "image/jpeg", "image/gif", "image/webp":
		return true
	}
	return false
}

func slugOf(r *http.Request) string {
	slug := chi.URLParam(r, "slug")
	if !paste.ValidateSlug(slug) {
		return ""
	}
	return slug
}

func expiresIn(raw string) int64 {
	value, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || value < 0 {
		return 0
	}
	return value
}
