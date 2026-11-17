package httpapi

import (
	"encoding/json"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/jakobbjelver/messer-paste/internal/config"
	"github.com/jakobbjelver/messer-paste/internal/paste"
	"github.com/jakobbjelver/messer-paste/internal/settings"
)

// settingsDTO is the page's whole world: every key, what it is, what it is now, and who set it.
type settingsDTO struct {
	Items  []settings.Value `json:"items"`
	Groups []string         `json:"groups"`
	Dirty  int              `json:"custom"`
}

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	values, err := s.resolveSettings(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, settingsDTO{
		Items:  ordered(values),
		Groups: groups(),
		Dirty:  countCustom(values),
	})
}

// patchSettings is the only write door. It validates everything before it persists anything: a body
// with one bad key changes nothing at all.
func (s *Server) patchSettings(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "E_INVALID")
		return
	}
	if len(body) == 0 {
		s.getSettings(w, r)
		return
	}
	values, err := s.resolveSettings(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}

	clean := map[string]any{}
	keys := make([]string, 0, len(body))
	for key := range body {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	for _, key := range keys {
		def, ok := settings.Lookup(key)
		if !ok {
			writeErrorDetail(w, http.StatusNotFound, "E_UNKNOWN_SETTING", key, "There is no setting called "+key+".")
			return
		}
		if def.Boot {
			writeErrorDetail(w, http.StatusConflict, "E_PINNED", key, def.Label+" comes from the environment and needs a restart.")
			return
		}
		if v := values[key]; v.Source == settings.FromEnv {
			writeErrorDetail(w, http.StatusConflict, "E_PINNED", key,
				def.Label+" is set by "+def.Env+" in the environment. Remove the variable to edit it here.")
			return
		}
		checked, err := settings.Check(def, body[key])
		if err != nil {
			writeErrorDetail(w, http.StatusUnprocessableEntity, "E_INVALID", key, humanise(key, err))
			return
		}
		clean[key] = checked
	}

	if err := s.store.SaveSettings(r.Context(), clean); err != nil {
		s.fail(w, r, err)
		return
	}
	next, err := s.applySettings(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.hub.Publish(paste.Event{Type: "settings"})
	writeJSON(w, http.StatusOK, settingsDTO{Items: ordered(next), Groups: groups(), Dirty: countCustom(next)})
}

// resetSetting drops the stored value so the default (or the pinned environment value) takes over.
func (s *Server) resetSetting(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	def, ok := settings.Lookup(key)
	if !ok {
		writeErrorDetail(w, http.StatusNotFound, "E_UNKNOWN_SETTING", key, "There is no setting called "+key+".")
		return
	}
	values, err := s.resolveSettings(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if v := values[key]; v.Source == settings.FromEnv {
		writeErrorDetail(w, http.StatusConflict, "E_PINNED", key, def.Label+" is set by "+def.Env+".")
		return
	}
	if err := s.store.DeleteSettings(r.Context(), []string{key}); err != nil {
		s.fail(w, r, err)
		return
	}
	next, err := s.applySettings(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.hub.Publish(paste.Event{Type: "settings"})
	writeJSON(w, http.StatusOK, settingsDTO{Items: ordered(next), Groups: groups(), Dirty: countCustom(next)})
}

// resolveSettings walks the three layers for this request: defaults, the database, the environment.
func (s *Server) resolveSettings(r *http.Request) (map[string]settings.Value, error) {
	stored, err := s.store.LoadSettings(r.Context())
	if err != nil {
		return nil, err
	}
	return settings.Resolve(os.LookupEnv, stored)
}

// applySettings re-resolves, swaps the snapshot and lets main rebuild what it implies.
func (s *Server) applySettings(r *http.Request) (map[string]settings.Value, error) {
	values, err := s.resolveSettings(r)
	if err != nil {
		return nil, err
	}
	next := config.FromValues(values)
	// The secret is generated on first boot and never round-trips through the page.
	if next.Secret == "" {
		next.Secret = s.conf().Secret
	}
	s.SetConfig(next)
	return values, nil
}

func ordered(values map[string]settings.Value) []settings.Value {
	out := make([]settings.Value, 0, len(values))
	for _, def := range settings.Defs {
		out = append(out, values[def.Key])
	}
	return out
}

func groups() []string {
	seen := map[string]bool{}
	out := []string{}
	for _, def := range settings.Defs {
		if !seen[def.Group] {
			seen[def.Group] = true
			out = append(out, def.Group)
		}
	}
	return out
}

func countCustom(values map[string]settings.Value) int {
	n := 0
	for _, v := range values {
		if v.Source == settings.FromCustom {
			n++
		}
	}
	return n
}

// humanise strips the key prefix the validation error carries: the row already knows its key.
func humanise(key string, err error) string {
	return strings.TrimPrefix(err.Error(), key+": ")
}

// readOnlyGuard refuses writes while the deployment is frozen. Settings are deliberately exempt:
// a switch that can strand the operator is a trap, not a feature.
func (s *Server) readOnlyGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.conf().ReadOnly {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		if r.URL.Path == "/api/v1/settings" {
			next.ServeHTTP(w, r)
			return
		}
		writeErrorDetail(w, http.StatusConflict, "E_READ_ONLY", "", "This paste is frozen: writes are off until the owner lifts it.")
	})
}

// policy applies the feature switches to a create or an update. It returns the reader cap the paste
// should carry, and false when the response has already been written.
func (s *Server) policy(w http.ResponseWriter, visibility string, burn bool, password string, maxViews int64, files int) (int64, bool) {
	cfg := s.conf()

	if visibility == paste.VisibilityPublic {
		if !cfg.PublicLinks {
			writeErrorDetail(w, http.StatusForbidden, "E_DISABLED", "visibility",
				"Public links are off in this deployment.")
			return 0, false
		}
		if cfg.PasswordRequired && password == "" {
			writeErrorDetail(w, http.StatusUnprocessableEntity, "E_INVALID", "password",
				"A public paste must carry a password here.")
			return 0, false
		}
		if maxViews == 0 && cfg.PublicMaxViews > 0 {
			maxViews = cfg.PublicMaxViews
		}
	}
	if burn && !cfg.BurnEnabled {
		writeErrorDetail(w, http.StatusUnprocessableEntity, "E_INVALID", "burn",
			"Burn after reading is off in this deployment.")
		return 0, false
	}
	if cfg.MaxFiles > 0 && int64(files) > cfg.MaxFiles {
		writeErrorDetail(w, http.StatusUnprocessableEntity, "E_INVALID", "files",
			"One paste may hold at most "+itoa(cfg.MaxFiles)+" files here.")
		return 0, false
	}
	return maxViews, true
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
