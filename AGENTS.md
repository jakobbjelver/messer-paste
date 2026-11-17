# AGENTS.md — Messer Paste

A single-user pastebin for text, images and files, served by one Go binary, meant to run behind an
authenticating proxy.

## What this is

Text, images and files, pasted or dropped, with expiry, burn-after-reading, public read-only links
and live updates across every open browser. One owner, no accounts and no sharing controls: the proxy
is the only gate. The unusual part is the storage split — metadata in SQLite, every byte of content in
a directory tree with the original filenames — and the UI updates over one SSE stream, never by
polling.

## Read first

- `README.md` — how to run it, and the API in one table.
- `docs/openapi.json` — the contract. Code that disagrees with it is a bug in the code.
- `docs/llms.txt` — the primer an agent reads before it touches anything.

## Layout

| Path | What |
|---|---|
| `cmd/messer-paste/` | entry point; `doctor` subcommand |
| `cmd/paste/` | the `mpaste` client, same binary, different door |
| `internal/paste/` | domain, slugs, content tree, service rules, expiry, events |
| `internal/store/` | SQLite rows (pastes, files, burn tombstones, view ledger) |
| `internal/httpapi/` | the only place a request is parsed or a status chosen; SSE hub; the public host router |
| `web/web.go` | embeds `web/app/dist`, SPA fallback, 503 when unbuilt |
| `web/app/` | React app (TanStack Router + Query, Messer UI) |

## Invariants

- **A handle is a cursor, never an id.** Slugs are 8 characters from a 31-character alphabet that
  omits `0`/`O` and `1`/`I`; no endpoint returns an auto-increment id.
- **`internal/httpapi` owns the status code.** Nothing below it writes a response.
- **Content never lives in the database.** A paste is a directory; the row is an index into it.
- **Burn is a tombstone.** The reveal response carries the payload and the delete; a second visitor
  gets `410`, not `404`.
- **The public host is a router, not a second app.** A private slug on the public host is `404`, and
  an unknown method is `404` too, so the route table cannot be probed.
- **Secrets are `0600` files** beside the database, created on first boot. Never in the environment,
  never in git.

## Commands

```bash
make check      # fmt-check, vet, race tests, SPA typecheck — the gate CI runs
make doctor     # env and volume sanity, no network
make e2e        # Playwright against the dev pair (needs both servers up)
make dev        # API :8015 + Vite :3015
```

## Gates

```bash
make check     # fmt-check, vet, race tests, and the SPA's tsc
make doctor    # database, content root, row/directory drift
```

`make doctor` checks the database, the content root, and drift between rows and directories.

## Conventions

- Errors are a JSON envelope: `{"error":{"code":"E_INVALID","message":"…","field":"password"}}`. A
  server sentence lands on the right control because `field` names it.
- Every list is cursor paged and answers `items`, `next_cursor`, `has_more`, `total`, `took_ms`.
- The UI is Messer UI: no handwritten reusable primitives, one icon family, zero radius, Golos for
  words and JetBrains Mono for code and keycaps.
- Copy is sentence case, second person, and says what happened rather than what failed.
