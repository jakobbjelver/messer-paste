package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/jakobbjelver/messer-paste/internal/config"
	"github.com/jakobbjelver/messer-paste/internal/httpapi"
	"github.com/jakobbjelver/messer-paste/internal/paste"
	"github.com/jakobbjelver/messer-paste/internal/store"
)

var (
	version = "dev"
	commit  = "none"
	built   = "unknown"
)

func main() {
	mode := "serve"
	if len(os.Args) > 1 {
		mode = os.Args[1]
	}

	cfg := config.Load()
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	var err error
	if cfg.Secret == "" {
		cfg.Secret, err = loadSecret(filepath.Join(cfg.DataDir, "unlock.key"))
		if err != nil {
			log.Error("unlock secret", "err", err)
			os.Exit(1)
		}
	}

	st, err := store.Open(filepath.Join(cfg.DataDir, "state.db"))
	if err != nil {
		log.Error("open database", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	tree, err := paste.NewStorage(cfg.PasteRoot)
	if err != nil {
		log.Error("content root", "root", cfg.PasteRoot, "err", err)
		os.Exit(1)
	}

	if mode == "doctor" {
		os.Exit(runDoctor(cfg, st, tree, log))
	}

	hub := httpapi.NewHub()
	svc := paste.NewService(st, tree, paste.Limits{
		Text:  cfg.MaxText,
		File:  cfg.MaxFile,
		Paste: cfg.MaxPaste,
		Burn:  cfg.MaxBurn,
	}, hub, log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if indexed, err := svc.BackfillSearch(ctx); err != nil {
		log.Warn("search backfill failed", "err", err)
	} else if indexed > 0 {
		log.Info("search index rebuilt", "rows", indexed)
	}

	if result, err := svc.Reconcile(ctx); err != nil {
		log.Warn("reconcile", "err", err)
	} else if result != (paste.ReconcileResult{}) {
		log.Info("reconciled", "orphanDirs", result.OrphanDirs, "missingDirs", result.MissingDirs)
	}

	go func() {
		ticker := time.NewTicker(cfg.ExpiryTick)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				svc.Sweep(ctx, time.Now().Unix())
			}
		}
	}()

	server := httpapi.New(cfg, svc, st, tree, hub, log)
	server.Version, server.Commit, server.Built = version, commit, built

	httpServer := &http.Server{
		Addr:              cfg.Listen,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		// No WriteTimeout: /api/events is a long-lived stream.
	}

	go func() {
		log.Info("listening", "addr", cfg.Listen, "version", version, "commit", commit, "public_host", cfg.PublicHost)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("serve", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdown); err != nil {
		log.Warn("shutdown", "err", err)
	}
}

// loadSecret keeps the unlock cookie valid across restarts without asking the operator for one: a
// random 32 bytes, created on first boot and read back after that.
func loadSecret(path string) (string, error) {
	if raw, err := os.ReadFile(path); err == nil && len(strings.TrimSpace(string(raw))) >= 32 {
		return strings.TrimSpace(string(raw)), nil
	}
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	secret := hex.EncodeToString(buffer)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(path, []byte(secret), 0o600); err != nil {
		return "", err
	}
	return secret, nil
}
