// Package httpapi is the only place a request is parsed or a status code chosen.
package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/jakobbjelver/messer-paste/docs"
	"github.com/jakobbjelver/messer-paste/internal/config"
	"github.com/jakobbjelver/messer-paste/internal/paste"
	"github.com/jakobbjelver/messer-paste/internal/store"
	"github.com/jakobbjelver/messer-paste/web"
)

var errBadRequest = errors.New("bad_request")

type Server struct {
	cfg     config.Config
	svc     *paste.Service
	store   *store.Store
	tree    *paste.Storage
	hub     *Hub
	log     *slog.Logger
	Version string
	Commit  string
	Built   string

	publicLimitRL *limiter
	unlockLimit   *limiter
}

func New(cfg config.Config, svc *paste.Service, st *store.Store, tree *paste.Storage, hub *Hub, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}
	return &Server{
		cfg: cfg, svc: svc, store: st, tree: tree, hub: hub, log: log,
		Version: "dev", Commit: "dev", Built: "unknown",
		publicLimitRL: newLimiter(cfg.PublicRate),
		unlockLimit:   newLimiter(cfg.UnlockRate),
	}
}

func (s *Server) Handler() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Recoverer)
	r.Use(s.requestLog)

	// One binary, two products. The host decides which, before any route is matched, so the two
	// route sets never share a lookup table.
	if s.cfg.PublicHost != "" {
		public := s.publicRouter()
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if s.isPublicHost(r) {
					public.ServeHTTP(w, r)
					return
				}
				next.ServeHTTP(w, r)
			})
		})
	}

	r.Get("/healthz", s.health)
	r.Get("/readyz", s.ready)
	r.Get("/llms.txt", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write(docs.LLMS)
	})

	r.Route("/api/v1", func(api chi.Router) {
		api.Get("/pastes", s.listPastes)
		api.Post("/pastes", s.createPaste)
		api.Delete("/pastes", s.purgePastes)
		api.Get("/events", s.events)
		api.Get("/config", s.config)
		api.Get("/openapi.json", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("Cache-Control", "public, max-age=300")
			_, _ = w.Write(docs.OpenAPI)
		})

		api.Route("/pastes/{slug}", func(item chi.Router) {
			item.Get("/", s.getPaste)
			item.Put("/", s.updatePaste)
			item.Delete("/", s.deletePaste)
			item.Get("/raw", s.rawPaste)
			item.Get("/files/{id}", s.filePaste)
			item.Post("/reveal", s.revealPaste)
		})
	})

	webHandler := web.Handler()
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeError(w, http.StatusNotFound, "E_NOT_FOUND")
			return
		}
		webHandler.ServeHTTP(w, r)
	})
	return r
}

func (s *Server) requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(rec, r)
		if strings.HasPrefix(r.URL.Path, "/api/events") {
			return // a stream never "finishes"; logging it as 200/0ms is noise
		}
		s.log.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.Status(),
			"bytes", rec.BytesWritten(),
			"ms", time.Since(start).Milliseconds(),
		)
	})
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"version": s.Version,
		"commit":  s.Commit,
		"built":   s.Built,
	})
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Ping(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "E_CONTENT_UNAVAILABLE")
		return
	}
	probe, err := os.CreateTemp(s.tree.Root(), ".ready-*")
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "E_CONTENT_UNAVAILABLE")
		return
	}
	name := probe.Name()
	probe.Close()
	_ = os.Remove(name)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func writeJSONBytes(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

var messages = map[string]string{
	"E_NOT_FOUND":           "That paste does not exist.",
	"E_GONE":                "That paste is gone.",
	"E_BURN_REQUIRED":       "This paste is revealed by reading it, not by opening it.",
	"E_TOO_LARGE":           "That is larger than this paste can hold.",
	"E_TEXT_TOO_LARGE":      "The text is larger than the paste limit.",
	"E_CONTENT_UNAVAILABLE": "The content volume is not available.",
	"E_INVALID":             "That request is not valid.",
	"E_INTERNAL":            "Something went wrong.",
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeErrorDetail(w, status, code, "", "")
}

// writeErrorDetail carries the form field a validation failure belongs to, and its sentence: the
// generic message for the code cannot say "a public paste must expire" without guessing.
func writeErrorDetail(w http.ResponseWriter, status int, code, field, detail string) {
	message := detail
	if message == "" {
		known, ok := messages[code]
		if !ok {
			known = messages["E_INTERNAL"]
		}
		message = known
	}
	writeJSON(w, status, errorDTO{Error: errorBody{Code: code, Message: message, Field: field}})
}

func statusFor(err error) (int, string) {
	switch {
	case errors.Is(err, paste.ErrNotFound):
		return http.StatusNotFound, "E_NOT_FOUND"
	case errors.Is(err, paste.ErrGone):
		return http.StatusGone, "E_GONE"
	case errors.Is(err, paste.ErrLocked):
		return http.StatusUnauthorized, "E_LOCKED"
	case errors.Is(err, paste.ErrBurnNeeded):
		return http.StatusConflict, "E_BURN_REQUIRED"
	case errors.Is(err, paste.ErrTooLarge):
		return http.StatusRequestEntityTooLarge, "E_TOO_LARGE"
	case errors.Is(err, paste.ErrTextTooBig):
		return http.StatusRequestEntityTooLarge, "E_TEXT_TOO_LARGE"
	case errors.Is(err, paste.ErrUnavailable):
		return http.StatusServiceUnavailable, "E_CONTENT_UNAVAILABLE"
	case errors.Is(err, paste.ErrInvalid), errors.Is(err, errBadRequest):
		return http.StatusBadRequest, "E_INVALID"
	default:
		return http.StatusInternalServerError, "E_INTERNAL"
	}
}

func (s *Server) fail(w http.ResponseWriter, r *http.Request, err error) {
	status, code := statusFor(err)
	if status >= 500 {
		s.log.Error("request failed", "path", r.URL.Path, "err", err)
	}
	var named paste.FieldError
	if errors.As(err, &named) {
		writeErrorDetail(w, status, code, named.Field, named.Message)
		return
	}
	writeError(w, status, code)
}
