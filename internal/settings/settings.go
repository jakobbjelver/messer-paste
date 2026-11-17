// Package settings is the one table of everything a deployment can change, and the rule that decides
// which layer wins.
//
// Three layers, in order: the default, the environment, the database. The environment is the ceiling
// — a key it sets is pinned, read-only in the UI, and it keeps whatever the UI last wrote underneath,
// so removing the variable restores the person's own value instead of snapping back to the default.
package settings

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Kind is how a value is parsed, validated and rendered.
type Kind string

const (
	KindInt      Kind = "int"
	KindBool     Kind = "bool"
	KindEnum     Kind = "enum"
	KindDuration Kind = "duration"
	KindText     Kind = "text"
	KindList     Kind = "list"
)

// Source says which layer produced the value that is in force.
type Source string

const (
	FromDefault Source = "default"
	FromEnv     Source = "env"
	FromCustom  Source = "custom"
)

// Def is one setting's definition. The zero value is never registered.
type Def struct {
	Key         string `json:"key"`
	Env         string `json:"env"`
	Group       string `json:"group"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Kind        Kind   `json:"kind"`
	Unit        string `json:"unit,omitempty"`
	// Default is int64, bool or string, matching Kind.
	Default  any      `json:"default"`
	Min      int64    `json:"min,omitempty"`
	Max      int64    `json:"max,omitempty"`
	Choices  []string `json:"choices,omitempty"`
	Boot     bool     `json:"boot"`
	Advanced bool     `json:"advanced,omitempty"`
}

// Value is a definition plus where it currently stands.
type Value struct {
	Def
	Value    any    `json:"value"`
	Source   Source `json:"source"`
	Editable bool   `json:"editable"`
}

// Defs is the whole catalog, in presentation order.
var Defs = []Def{
	// ---- limits ------------------------------------------------------------------------------
	{
		Key: "max_text_bytes", Env: "MAX_TEXT_BYTES", Group: "Limits",
		Label: "Text", Description: "The largest text body a paste may carry.",
		Kind: KindInt, Unit: "bytes", Default: int64(2 << 20), Min: 1024, Max: 64 << 20,
	},
	{
		Key: "max_file_bytes", Env: "MAX_FILE_BYTES", Group: "Limits",
		Label: "One file", Description: "The largest single attachment.",
		Kind: KindInt, Unit: "bytes", Default: int64(100 << 20), Min: 1024, Max: 4 << 30,
	},
	{
		Key: "max_paste_bytes", Env: "MAX_PASTE_BYTES", Group: "Limits",
		Label: "One paste", Description: "Text and files together.",
		Kind: KindInt, Unit: "bytes", Default: int64(250 << 20), Min: 1024, Max: 8 << 30,
	},
	{
		Key: "max_burn_bytes", Env: "MAX_BURN_BYTES", Group: "Limits",
		Label: "Burn paste", Description: "A burn paste is returned inline, so it is capped harder.",
		Kind: KindInt, Unit: "bytes", Default: int64(10 << 20), Min: 1024, Max: 512 << 20,
	},
	{
		Key: "max_files", Env: "MAX_FILES", Group: "Limits",
		Label: "Files", Description: "How many attachments one paste may hold.",
		Kind: KindInt, Default: int64(20), Min: 1, Max: 200,
	},

	// ---- behaviour ---------------------------------------------------------------------------
	{
		Key: "default_expiry", Env: "DEFAULT_EXPIRY", Group: "Behaviour",
		Label: "Default expiry", Description: "What the composer starts on.",
		Kind: KindDuration, Default: "24h", Choices: []string{"1h", "24h", "7d", "30d", "0"},
	},
	{
		Key: "expiry_choices", Env: "EXPIRY_CHOICES", Group: "Behaviour",
		Label: "Expiry presets", Description: "Which buttons appear, in order. 0 means never.",
		Kind: KindList, Default: "1h,24h,7d,0",
	},
	{
		Key: "default_visibility", Env: "DEFAULT_VISIBILITY", Group: "Behaviour",
		Label: "Default visibility", Description: "Only meaningful when public links are on.",
		Kind: KindEnum, Default: "private", Choices: []string{"private", "public"},
	},
	{
		Key: "burn_enabled", Env: "BURN_ENABLED", Group: "Behaviour",
		Label: "Burn after reading", Description: "Allow burn pastes at all.",
		Kind: KindBool, Default: true,
	},
	{
		Key: "auto_title", Env: "AUTO_TITLE", Group: "Behaviour",
		Label: "Derive titles", Description: "When no title is given, take the first line, a filename, or a count.",
		Kind: KindBool, Default: true,
	},
	{
		Key: "copy_on_create", Env: "COPY_ON_CREATE", Group: "Behaviour",
		Label: "Copy the link", Description: "Put the new URL on the clipboard after Create.",
		Kind: KindBool, Default: true,
	},
	{
		Key: "log_level", Env: "LOG_LEVEL", Group: "Behaviour",
		Label: "Log level", Description: "debug, info, warn or error.",
		Kind: KindEnum, Default: "info", Choices: []string{"debug", "info", "warn", "error"}, Advanced: true,
	},
	{
		Key: "read_only", Env: "READ_ONLY", Group: "Behaviour",
		Label: "Freeze writes", Description: "Refuse every write with E_READ_ONLY. Settings stay writable.",
		Kind: KindBool, Default: false, Advanced: true,
	},

	// ---- public links ------------------------------------------------------------------------
	{
		Key: "public_links", Env: "PUBLIC_LINKS", Group: "Public links",
		Label: "Turn it on", Description: "A read-only host, and a visibility choice in the composer.",
		Kind: KindBool, Default: false,
	},
	{
		Key: "public_host", Env: "PUBLIC_HOST", Group: "Public links",
		Label: "Public host", Description: "The hostname that serves public pastes. Required when public links are on.",
		Kind: KindText, Default: "",
	},
	{
		Key: "public_password_required", Env: "PUBLIC_PASSWORD_REQUIRED", Group: "Public links",
		Label: "Require a password", Description: "Refuse a public paste that has none.",
		Kind: KindBool, Default: false,
	},
	{
		Key: "public_default_max_views", Env: "PUBLIC_DEFAULT_MAX_VIEWS", Group: "Public links",
		Label: "Default reader cap", Description: "Zero means no cap.",
		Kind: KindInt, Default: int64(0), Min: 0, Max: 1_000_000,
	},
	{
		Key: "unlock_ttl", Env: "UNLOCK_TTL", Group: "Public links",
		Label: "Unlock cookie", Description: "How long a correct password is remembered in the browser.",
		Kind: KindDuration, Default: "168h", Choices: []string{"1h", "24h", "168h", "720h"},
	},

	// ---- retention and safety ----------------------------------------------------------------
	{
		Key: "purge_after", Env: "PURGE_AFTER", Group: "Retention",
		Label: "Delete after", Description: "Delete pastes older than this on every sweep. Zero means never.",
		Kind: KindDuration, Default: "0", Choices: []string{"0", "168h", "720h", "2160h"},
	},
	{
		Key: "view_ledger_window", Env: "VIEW_LEDGER_WINDOW", Group: "Retention",
		Label: "Reader memory", Description: "How long an address counts as the same reader for a view cap.",
		Kind: KindDuration, Default: "48h",
	},
	{
		Key: "public_rate_per_min", Env: "PUBLIC_RATE_PER_MIN", Group: "Retention",
		Label: "Public requests", Description: "Per address, per minute, on the public host.",
		Kind: KindInt, Default: int64(120), Min: 10, Max: 10_000,
	},
	{
		Key: "unlock_rate_per_min", Env: "UNLOCK_RATE_PER_MIN", Group: "Retention",
		Label: "Password attempts", Description: "Per address, per minute.",
		Kind: KindInt, Default: int64(10), Min: 1, Max: 1000,
	},

	// ---- interface ---------------------------------------------------------------------------
	{
		Key: "recent_page_size", Env: "RECENT_PAGE_SIZE", Group: "Interface",
		Label: "Archive page", Description: "Rows per page in Recent.",
		Kind: KindInt, Default: int64(50), Min: 10, Max: 200,
	},
	{
		Key: "search_min_chars", Env: "SEARCH_MIN_CHARS", Group: "Interface",
		Label: "Shortest search", Description: "Queries shorter than this list everything.",
		Kind: KindInt, Default: int64(2), Min: 1, Max: 10,
	},
	{
		Key: "share_base", Env: "SHARE_BASE", Group: "Interface",
		Label: "Link base", Description: "Origin used for copied links. Empty means the request's own origin.",
		Kind: KindText, Default: "",
	},

	// ---- boot only ---------------------------------------------------------------------------
	{
		Key: "port", Env: "PORT", Group: "This process", Boot: true,
		Label: "Listen", Description: "The address the binary binds.",
		Kind: KindText, Default: ":8080",
	},
	{
		Key: "data_dir", Env: "DATA_DIR", Group: "This process", Boot: true,
		Label: "Data", Description: "SQLite, its WAL, and the unlock key.",
		Kind: KindText, Default: "/data",
	},
	{
		Key: "paste_root", Env: "PASTE_ROOT", Group: "This process", Boot: true,
		Label: "Content", Description: "One directory per paste.",
		Kind: KindText, Default: "/pastes",
	},
	{
		Key: "secret", Env: "PASTE_SECRET", Group: "This process", Boot: true,
		Label: "Secret", Description: "Signs the unlock cookie. Generated into a 0600 file when empty.",
		Kind: KindText, Default: "",
	},
}

var byKey = func() map[string]Def {
	m := make(map[string]Def, len(Defs))
	for _, d := range Defs {
		m[d.Key] = d
	}
	return m
}()

// Lookup returns a definition by key.
func Lookup(key string) (Def, bool) {
	d, ok := byKey[key]
	return d, ok
}

// Keys returns every key, sorted, for the doctor and for tests.
func Keys() []string {
	out := make([]string, 0, len(byKey))
	for k := range byKey {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// Duration reads a span written the way a person writes one: 90m, 24h, 7d, 4w. Go's own parser has
// no day, and "7d" is the label on the button.
func Duration(raw string) (time.Duration, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "0" {
		return 0, nil
	}
	unit := raw[len(raw)-1]
	if unit == 'd' || unit == 'w' {
		n, err := strconv.ParseInt(raw[:len(raw)-1], 10, 64)
		if err != nil {
			return 0, err
		}
		if unit == 'd' {
			return time.Duration(n) * 24 * time.Hour, nil
		}
		return time.Duration(n) * 7 * 24 * time.Hour, nil
	}
	return time.ParseDuration(raw)
}

// Parse turns the text of an environment variable into the typed value for a definition.
func Parse(d Def, raw string) (any, error) {
	raw = strings.TrimSpace(raw)
	switch d.Kind {
	case KindInt:
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("%s: %q is not a number", d.Key, raw)
		}
		return n, nil
	case KindBool:
		switch strings.ToLower(raw) {
		case "1", "true", "yes", "on":
			return true, nil
		case "0", "false", "no", "off":
			return false, nil
		}
		return nil, fmt.Errorf("%s: %q is not a yes or no", d.Key, raw)
	case KindDuration:
		if raw == "" {
			return nil, fmt.Errorf("%s: empty", d.Key)
		}
		if raw == "0" {
			return "0", nil
		}
		if _, err := Duration(raw); err != nil {
			return nil, fmt.Errorf("%s: %q is not a duration", d.Key, raw)
		}
		return raw, nil
	case KindEnum, KindText, KindList:
		return raw, nil
	}
	return nil, fmt.Errorf("%s: unknown kind %q", d.Key, d.Kind)
}

// Check validates a typed value against its definition and returns it normalised.
func Check(d Def, value any) (any, error) {
	switch d.Kind {
	case KindInt:
		n, ok := asInt(value)
		if !ok {
			return nil, fmt.Errorf("%s must be a number", d.Key)
		}
		if n < d.Min || (d.Max > 0 && n > d.Max) {
			return nil, fmt.Errorf("%s must be between %d and %d", d.Key, d.Min, d.Max)
		}
		return n, nil
	case KindBool:
		if b, ok := value.(bool); ok {
			return b, nil
		}
		return nil, fmt.Errorf("%s must be true or false", d.Key)
	case KindDuration:
		s, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("%s must be a duration", d.Key)
		}
		s = strings.TrimSpace(s)
		if s == "" || s == "0" {
			return "0", nil
		}
		if _, err := Duration(s); err != nil {
			return nil, fmt.Errorf("%s: %q is not a duration", d.Key, s)
		}
		return s, nil
	case KindEnum:
		s, ok := value.(string)
		if !ok || !contains(d.Choices, s) {
			return nil, fmt.Errorf("%s must be one of %s", d.Key, strings.Join(d.Choices, ", "))
		}
		return s, nil
	case KindList:
		s, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("%s must be a comma-separated list", d.Key)
		}
		parts := []string{}
		for _, p := range strings.Split(s, ",") {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			if _, err := Duration(p); err != nil && p != "0" {
				return nil, fmt.Errorf("%s: %q is not a duration", d.Key, p)
			}
			parts = append(parts, p)
		}
		if len(parts) == 0 {
			return nil, fmt.Errorf("%s must contain at least one entry", d.Key)
		}
		return strings.Join(parts, ","), nil
	case KindText:
		s, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("%s must be text", d.Key)
		}
		return strings.TrimSpace(s), nil
	}
	return nil, fmt.Errorf("%s: unknown kind %q", d.Key, d.Kind)
}

// Resolve walks the three layers and returns every setting with its winner. env is consulted by the
// definition's variable name; stored is what the database holds.
func Resolve(env func(string) (string, bool), stored map[string]any) (map[string]Value, error) {
	out := make(map[string]Value, len(Defs))
	for _, d := range Defs {
		v := Value{Def: d, Value: d.Default, Source: FromDefault, Editable: !d.Boot}

		// The database holds what the page last wrote. It is read first so that an environment
		// value can win without destroying it.
		if raw, ok := stored[d.Key]; ok {
			v.Value = raw
			v.Source = FromCustom
		}
		if raw, ok := env(d.Env); ok && strings.TrimSpace(raw) != "" {
			parsed, err := Parse(d, raw)
			if err != nil {
				return nil, err
			}
			v.Value = parsed
			v.Source = FromEnv
			v.Editable = false
		}
		checked, err := Check(d, v.Value)
		if err != nil {
			return nil, fmt.Errorf("%s (from %s): %w", d.Key, v.Source, err)
		}
		v.Value = checked
		out[d.Key] = v
	}
	return out, nil
}

func asInt(v any) (int64, bool) {
	switch n := v.(type) {
	case int64:
		return n, true
	case int:
		return int64(n), true
	case float64:
		return int64(n), true
	case string:
		parsed, err := strconv.ParseInt(strings.TrimSpace(n), 10, 64)
		return parsed, err == nil
	}
	return 0, false
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
