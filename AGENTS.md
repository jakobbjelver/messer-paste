# AGENTS.md — Messer Paste

A single-user pastebin at `paste.example.com`, behind an authenticating proxy, served by one Go binary.

## What this is

Text, images and files, pasted or dropped, with expiry, burn-after-reading and live updates across
every open browser. One owner, no accounts and no sharing controls: the Access wall is the
only gate. The unusual part is the storage split — metadata in SQLite on the SSD, every byte of
content in a directory tree on the Media volume — and the UI updates over one SSE stream, never by
polling.

## Read first

- `PROJECT.yaml` — the machine-readable facts (tier, stack, deploy, ports, exceptions).
- `README.md` — how to run it.
- Skill `messer-paste` — live state, diagnosis ladders and traps.
- `.hermes/plans/2026-11-16_115356-messer-paste-build.md` — the build plan this came from.

## Layout

| Path | What |
|---|---|
| `cmd/messer-paste/` | entry point; `doctor` subcommand |
| `internal/paste/` | domain, slugs, content tree, service rules, expiry, events |
| `internal/store/` | SQLite rows (pastes, files, burn tombstones) |
| `internal/httpapi/` | the only place a request is parsed or a status chosen; SSE hub |
| `web/web.go` | embeds `web/app/dist`, SPA fallback, 503 when unbuilt |
| `web/app/` | React app (TanStack Router + Query, Messer UI) |
| `deploy/` | container assets (the Dockerfile is at the root, from the template) |
| `actions/actions.json` | Portal dev-server action |

## Commands

```bash
make dev        # Go :8015 + Vite :3015, one trap for both
make test       # go test (builds the web first; the binary embeds dist)
make lint       # fmt-check + vet
make typecheck  # tsc -b --noEmit
make build      # web + Go binary in bin/
make check      # fmt-check + vet + race + typecheck
make doctor     # db, content root, row/dir reconciliation, free space
```

Every command is non-interactive and exits non-zero on failure.

## Invariants

- Content lives under `PASTE_ROOT/<SLUG>/` on the Media bind mount; SQLite lives on the SSD
  (`${SERVER_CONFIGS_DIR}/apps/paste/data`). A reset of one must be reconcilable from the other.
- The container publishes no host port. Caddy reaches `messer-paste:8080` on `server_network`.
- Expiry, burn and purge delete permanently. There is no trash and no restore.
- `/api/events` is the only EventSource in the app; the `/ui` sink never opens one (the conformance
  harness waits for `networkidle`).
- No auth in the app. an authenticating proxy is the gate; a 200 from an unauthenticated public request
  is a security bug.
- Uploads are streamed to a staging dir, committed by rename/copy, and every name passes `SafeName`.

## Working rules

- Deploy is CI → image → the deploy runner. Never `docker compose` a the deploy runner stack.
- The dev server is started from the Portal action, never from a shell that outlives the session.
- Secrets are `0600` files, never git, never a the deploy runner stack environment.
- Delete the old layer in the same change that ships the new one. No compatibility shims.
- Update `PROJECT.yaml`, this file and the skill in the same PR as a structural change.

## Where the depth is

Skill `messer-paste` — operating the live thing, diagnosis, incidents and references.
Plan: `.hermes/plans/2026-11-16_115356-messer-paste-build.md`.
