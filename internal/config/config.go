// Package config reads the handful of paths and limits the app runs on. Every value has a
// production-safe default so the binary starts with no environment at all.
//
// The values themselves live in internal/settings, which knows which layer set each one; this package
// is the typed shape the rest of the program uses.
package config

import (
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jakobbjelver/messer-paste/internal/settings"
)

// ExpiryChoice is one preset the composer offers: seconds, and the label to print.
type ExpiryChoice struct {
	Seconds int64
	Label   string
}

type Config struct {
	DataDir    string // sqlite + upload staging
	PasteRoot  string // the content tree (a bind mount on Media)
	Listen     string
	MaxText    int64
	MaxFile    int64
	MaxPaste   int64
	MaxBurn    int64
	MaxFiles   int64
	ExpiryTick time.Duration

	// PublicHost is the hostname that serves public pastes. PublicLinks is the feature switch: when
	// it is false the public router is never built, whatever the host says.
	PublicHost       string
	PublicLinks      bool
	PasswordRequired bool
	PublicMaxViews   int64
	UnlockTTL        time.Duration

	// Secret signs the unlock cookie. main creates it on first boot if it is empty.
	Secret string

	// PublicRate and UnlockRate are per-IP requests per minute on the public host.
	PublicRate int
	UnlockRate int

	DefaultExpiry    time.Duration
	ExpiryChoices    []ExpiryChoice
	DefaultPublic    bool
	BurnEnabled      bool
	AutoTitle        bool
	CopyOnCreate     bool
	ReadOnly         bool
	PurgeAfter       time.Duration
	ViewLedgerWindow time.Duration
	RecentPageSize   int
	SearchMinChars   int
	ShareBase        string
	LogLevel         string

	// Values is every setting with the layer that produced it, for /api/v1/settings and doctor.
	Values map[string]settings.Value
}

// Load reads the defaults overlaid with the environment. A deployment that has never opened the
// settings page runs on exactly this.
func Load() Config {
	values, err := settings.Resolve(os.LookupEnv, nil)
	if err != nil {
		// An unparseable environment variable is a deployment mistake; fall back to the default for
		// that key rather than refusing to boot, and let doctor say which one it is.
		values, _ = settings.Resolve(func(string) (string, bool) { return "", false }, nil)
	}
	return FromValues(values)
}

// Default is the configuration a fresh install runs on: every default, nothing from the environment
// and nothing from the settings page.
func Default() Config {
	values, _ := settings.Resolve(func(string) (string, bool) { return "", false }, nil)
	return FromValues(values)
}

// FromValues turns resolved settings into the typed struct the program passes around.
func FromValues(values map[string]settings.Value) Config {
	get := func(key string) settings.Value { return values[key] }
	i := func(key string) int64 {
		if v, ok := get(key).Value.(int64); ok {
			return v
		}
		return 0
	}
	b := func(key string) bool {
		v, _ := get(key).Value.(bool)
		return v
	}
	s := func(key string) string {
		v, _ := get(key).Value.(string)
		return v
	}
	d := func(key string) time.Duration {
		raw, _ := get(key).Value.(string)
		if raw == "" || raw == "0" {
			return 0
		}
		parsed, _ := settings.Duration(raw)
		return parsed
	}

	choices := []ExpiryChoice{}
	for _, raw := range strings.Split(s("expiry_choices"), ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		if raw == "0" {
			choices = append(choices, ExpiryChoice{Seconds: 0, Label: "never"})
			continue
		}
		parsed, err := settings.Duration(raw)
		if err != nil {
			continue
		}
		choices = append(choices, ExpiryChoice{Seconds: int64(parsed.Seconds()), Label: short(parsed)})
	}

	publicLinks := b("public_links")
	if !publicLinks && s("public_host") != "" {
		// Before the switch existed, PUBLIC_HOST was the whole feature. Silence must not turn it
		// off on upgrade; an explicit write from the page (source "custom") is the way to turn it off.
		if src := get("public_links").Source; src == settings.FromDefault {
			publicLinks = true
		}
	}

	return Config{
		DataDir:          s("data_dir"),
		PasteRoot:        s("paste_root"),
		Listen:           s("port"),
		MaxText:          i("max_text_bytes"),
		MaxFile:          i("max_file_bytes"),
		MaxPaste:         i("max_paste_bytes"),
		MaxBurn:          i("max_burn_bytes"),
		MaxFiles:         i("max_files"),
		ExpiryTick:       30 * time.Second,
		PublicHost:       s("public_host"),
		PublicLinks:      publicLinks,
		PasswordRequired: b("public_password_required"),
		PublicMaxViews:   i("public_default_max_views"),
		UnlockTTL:        d("unlock_ttl"),
		Secret:           s("secret"),
		PublicRate:       int(i("public_rate_per_min")),
		UnlockRate:       int(i("unlock_rate_per_min")),
		DefaultExpiry:    d("default_expiry"),
		ExpiryChoices:    choices,
		DefaultPublic:    s("default_visibility") == "public",
		BurnEnabled:      b("burn_enabled"),
		AutoTitle:        b("auto_title"),
		CopyOnCreate:     b("copy_on_create"),
		ReadOnly:         b("read_only"),
		PurgeAfter:       d("purge_after"),
		ViewLedgerWindow: d("view_ledger_window"),
		RecentPageSize:   int(i("recent_page_size")),
		SearchMinChars:   int(i("search_min_chars")),
		ShareBase:        s("share_base"),
		LogLevel:         s("log_level"),
		Values:           values,
	}
}

// short renders a duration as the preset label a button carries: 1h, 24h, 7d, 30d.
func short(d time.Duration) string {
	switch {
	case d < 48*time.Hour && d%time.Hour == 0:
		return strconv.Itoa(int(d/time.Hour)) + "h"
	case d%(24*time.Hour) == 0:
		return strconv.Itoa(int(d/(24*time.Hour))) + "d"
	case d%time.Hour == 0:
		return strconv.Itoa(int(d/time.Hour)) + "h"
	}
	return d.String()
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int64) int64 {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
