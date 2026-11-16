package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"syscall"

	"github.com/jakobbjelver/messer-paste/internal/config"
	"github.com/jakobbjelver/messer-paste/internal/paste"
	"github.com/jakobbjelver/messer-paste/internal/store"
)

// runDoctor checks the three things that make this service look alive while being useless: a
// closed database, an unwritable content root, and rows whose files (or files whose rows) are gone.
func runDoctor(cfg config.Config, st *store.Store, tree *paste.Storage, log *slog.Logger) int {
	ctx := context.Background()
	failed := false
	report := func(ok bool, label, detail string) {
		status := "ok"
		if !ok {
			status = "FAIL"
			failed = true
		}
		fmt.Printf("%-4s %-10s %s\n", status, label, detail)
	}

	if err := st.Ping(ctx); err != nil {
		report(false, "db", err.Error())
	} else {
		count, err := st.Count(ctx)
		report(err == nil, "db", fmt.Sprintf("%s, %d pastes", filepathOf(cfg), count))
	}

	if _, err := tree.Slugs(); err != nil {
		report(false, "content", err.Error())
	} else {
		report(true, "content", tree.Root())
	}

	rows, err := st.AllSlugs(ctx)
	if err != nil {
		report(false, "reconcile", err.Error())
	} else {
		dirs, dirErr := tree.Slugs()
		if dirErr != nil {
			report(false, "reconcile", dirErr.Error())
		} else {
			missing, orphan := 0, 0
			known := map[string]bool{}
			for _, slug := range rows {
				known[slug] = true
				if _, err := os.Stat(tree.Dir(slug)); err != nil {
					missing++
				}
			}
			for _, dir := range dirs {
				if !known[dir] {
					orphan++
				}
			}
			report(missing == 0 && orphan == 0, "reconcile",
				fmt.Sprintf("%d rows, %d dirs, %d missing, %d orphan", len(rows), len(dirs), missing, orphan))
		}
	}
	if indexed, err := st.SearchCount(ctx); err != nil {
		report(false, "search", err.Error())
	} else {
		report(indexed == len(rows), "search", fmt.Sprintf("%d indexed rows, %d pastes", indexed, len(rows)))
	}

	var stat syscall.Statfs_t
	if err := syscall.Statfs(tree.Root(), &stat); err == nil {
		free := float64(stat.Bavail) * float64(stat.Bsize) / 1e9
		report(free > 1, "space", fmt.Sprintf("%.1f GB free", free))
	}

	if failed {
		log.Error("doctor found problems")
		return 1
	}
	return 0
}

func filepathOf(cfg config.Config) string {
	return cfg.DataDir + "/state.db"
}
