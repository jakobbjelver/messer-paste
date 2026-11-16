// Package config reads the handful of paths and limits the app runs on. Every value has a
// production-safe default so the binary starts with no environment at all.
package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	DataDir    string // sqlite + upload staging
	PasteRoot  string // the content tree (a bind mount on Media)
	Listen     string
	MaxText    int64
	MaxFile    int64
	MaxPaste   int64
	MaxBurn    int64
	ExpiryTick time.Duration

	// PublicHost is the hostname that serves public pastes. Empty disables the feature: every
	// request is then the private app, which is what the binary did before v0.3.
	PublicHost string
	// Secret signs the unlock cookie. main creates it on first boot if it is empty.
	Secret string
	// PublicRate and UnlockRate are per-IP requests per minute on the public host.
	PublicRate int
	UnlockRate int
}

func Load() Config {
	return Config{
		DataDir:    env("DATA_DIR", "/data"),
		PasteRoot:  env("PASTE_ROOT", "/pastes"),
		Listen:     env("PORT", ":8080"),
		MaxText:    envInt("MAX_TEXT_BYTES", 2<<20),
		MaxFile:    envInt("MAX_FILE_BYTES", 100<<20),
		MaxPaste:   envInt("MAX_PASTE_BYTES", 250<<20),
		MaxBurn:    envInt("MAX_BURN_BYTES", 10<<20),
		ExpiryTick: 30 * time.Second,
		PublicHost: strings.TrimSpace(env("PUBLIC_HOST", "")),
		Secret:     env("PASTE_SECRET", ""),
		PublicRate: int(envInt("PUBLIC_RATE_PER_MIN", 120)),
		UnlockRate: int(envInt("UNLOCK_RATE_PER_MIN", 10)),
	}
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
