package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/jakobbjelver/messer-paste/internal/paste"
	"github.com/jakobbjelver/messer-paste/web"
)

// The public host is a different app on the same binary: no list, no search, no create, no edit, no
// events. Only "read this one paste" and "unlock it". Everything else is a 404 here, whether or not
// the route exists on the private host — a 405 would confirm what is behind the wall.
const unlockCookie = "mp_unlock"

func (s *Server) isPublicHost(r *http.Request) bool {
	want := strings.TrimSpace(s.conf().PublicHost)
	if want == "" {
		return false
	}
	got := r.Host
	if host, port, err := net.SplitHostPort(want); err == nil {
		return got == host+":"+port
	}
	if host, _, err := net.SplitHostPort(got); err == nil {
		got = host
	}
	return strings.EqualFold(got, want)
}

func (s *Server) unlocked(r *http.Request, slug string) bool {
	cookie, err := r.Cookie(unlockCookie)
	if err != nil || cookie.Value == "" {
		return false
	}
	return paste.VerifyUnlock(s.conf().Secret, cookie.Value, slug, time.Now().Unix())
}

func (s *Server) publicRouter() http.Handler {
	r := chi.NewRouter()
	r.Use(s.publicLimit)
	r.Get("/healthz", s.health)
	r.Get("/api/v1/config", s.config)
	r.Post("/api/v1/pastes/{slug}/unlock", s.publicUnlock)
	r.Get("/api/v1/pastes/{slug}", s.publicPaste)
	r.Get("/api/v1/pastes/{slug}/raw", s.publicRaw)
	r.Get("/api/v1/pastes/{slug}/files/{id}", s.publicFile)

	webHandler := web.Handler()
	notFound := func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeError(w, http.StatusNotFound, "E_NOT_FOUND")
			return
		}
		webHandler.ServeHTTP(w, r)
	}
	r.NotFound(notFound)
	// 405 would confirm the route exists on the other host.
	r.MethodNotAllowed(notFound)
	return r
}

// config tells the SPA which host is which. The same bundle is served from both, so this is the only
// way the client can know it is the public reader and not the app.
func (s *Server) config(w http.ResponseWriter, _ *http.Request) {
	cfg := s.conf()
	visibility := "private"
	if cfg.DefaultPublic {
		visibility = "public"
	}
	choices := make([]map[string]any, 0, len(cfg.ExpiryChoices))
	for _, c := range cfg.ExpiryChoices {
		choices = append(choices, map[string]any{"seconds": c.Seconds, "label": c.Label})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"public_links":       cfg.PublicLinks,
		"public_host":        cfg.PublicHost,
		"share_base":         cfg.ShareBase,
		"read_only":          cfg.ReadOnly,
		"burn_enabled":       cfg.BurnEnabled,
		"copy_on_create":     cfg.CopyOnCreate,
		"password_required":  cfg.PasswordRequired,
		"default_expiry":     int64(cfg.DefaultExpiry.Seconds()),
		"default_visibility": visibility,
		"expiry_choices":     choices,
		"recent_page_size":   cfg.RecentPageSize,
		"search_min_chars":   cfg.SearchMinChars,
		"limits": map[string]int64{
			"text":  cfg.MaxText,
			"file":  cfg.MaxFile,
			"paste": cfg.MaxPaste,
			"burn":  cfg.MaxBurn,
			"files": cfg.MaxFiles,
		},
	})
}

func (s *Server) publicPaste(w http.ResponseWriter, r *http.Request) {
	slug := slugOf(r)
	p, err := s.svc.Resolve(r.Context(), slug, paste.PublicSpec{
		Unlocked: s.unlocked(r, slug),
		IP:       clientIP(r),
	})
	if errors.Is(err, paste.ErrLocked) {
		// 200 with the shape of a locked record: the reader needs an unlock form, and the fact that
		// a slug exists is already implied by the URL the visitor was given.
		writeJSON(w, http.StatusOK, dtoPaste(p))
		return
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, dtoPaste(p))
}

func (s *Server) publicUnlock(w http.ResponseWriter, r *http.Request) {
	if s.unlockLimit != nil && !s.unlockLimit.allow(clientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "E_RATE_LIMIT")
		return
	}
	slug := slugOf(r)
	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "E_BAD_REQUEST")
		return
	}
	if err := s.svc.Unlock(r.Context(), slug, body.Password); err != nil {
		s.fail(w, r, err)
		return
	}
	ttl := s.conf().UnlockTTL
	if ttl <= 0 {
		ttl = time.Hour
	}
	expires := time.Now().Add(ttl)
	http.SetCookie(w, &http.Cookie{
		Name:     unlockCookie,
		Value:    paste.SignUnlock(s.conf().Secret, slug, expires.Unix()),
		Path:     "/",
		HttpOnly: true,
		Secure:   r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"),
		SameSite: http.SameSiteLaxMode,
		Expires:  expires,
		MaxAge:   3600,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) publicRaw(w http.ResponseWriter, r *http.Request) {
	slug := slugOf(r)
	if _, err := s.svc.Resolve(r.Context(), slug, paste.PublicSpec{
		Unlocked: s.unlocked(r, slug),
		IP:       clientIP(r),
	}); err != nil {
		s.fail(w, r, err)
		return
	}
	s.serveRaw(w, r, slug)
}

func (s *Server) publicFile(w http.ResponseWriter, r *http.Request) {
	slug := slugOf(r)
	if _, err := s.svc.Resolve(r.Context(), slug, paste.PublicSpec{
		Unlocked: s.unlocked(r, slug),
		IP:       clientIP(r),
	}); err != nil {
		s.fail(w, r, err)
		return
	}
	s.serveFile(w, r, slug)
}

func clientIP(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// limiter is a per-key minute bucket. It is deliberately small and in-memory: the public host is one
// person's pastebin, and the point is to stop a loop, not to run a billing meter.
type limiter struct {
	mu    sync.Mutex
	rate  int
	until map[string]entry
}

type entry struct {
	count int
	reset time.Time
}

func newLimiter(perMinute int) *limiter {
	if perMinute <= 0 {
		return nil
	}
	return &limiter{rate: perMinute, until: make(map[string]entry, 256)}
}

// reset re-arms the limiter with a new rate. A zero rate disables it, which is why the caller keeps
// the pointer: a limiter that exists but allows everything is simpler than a nil check at each use.
func (l *limiter) reset(perMinute int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if perMinute <= 0 {
		l.rate = 0
		l.until = map[string]entry{}
		return
	}
	l.rate = perMinute
	l.until = map[string]entry{}
}

func (l *limiter) allow(key string) bool {
	if l == nil {
		return true
	}
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.until) > 4096 {
		for k, v := range l.until {
			if now.After(v.reset) {
				delete(l.until, k)
			}
		}
	}
	slot, seen := l.until[key]
	if !seen || now.After(slot.reset) {
		l.until[key] = entry{count: 1, reset: now.Add(time.Minute)}
		return true
	}
	if slot.count >= l.rate {
		return false
	}
	slot.count++
	l.until[key] = slot
	return true
}

func (s *Server) publicLimit(next http.Handler) http.Handler {
	if s.publicLimitRL == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.publicLimitRL.allow(clientIP(r)) {
			writeError(w, http.StatusTooManyRequests, "E_RATE_LIMIT")
			return
		}
		next.ServeHTTP(w, r)
	})
}
