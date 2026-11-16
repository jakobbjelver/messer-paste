# Messer Paste

A minimal pastebin for text, images and files — drop it, paste it, edit it, burn it. Single user,
self-hosted at **paste.example.com**, meant to sit behind your own access layer.

- **Backend:** Go 1.26, chi, SQLite (`modernc`, no cgo), content on disk
- **Frontend:** React 19 + Vite 8 + TanStack Router/Query, Messer UI (port 1, brand `paste`)
- **Realtime:** one SSE stream (`/api/events`); no polling
- **Storage:** metadata on the SSD configs volume, content under `/content/pastes/<SLUG>/`

## Run

```bash
make dev        # Go :8015 + Vite :3015
open http://127.0.0.1:3015
```

The first run creates `.dev/data` and `.dev/pastes`. `make doctor` checks the database, the content
root and row/dir drift.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/v1/pastes` | page or search: `?q=&limit=&cursor=` → `items, next_cursor, has_more, total, took_ms` |
| POST | `/api/v1/pastes` | create (multipart; `Idempotency-Key` honoured) |
| GET | `/api/v1/pastes/{slug}` | detail; `409` for an unrevealed burn paste |
| PUT | `/api/v1/pastes/{slug}` | replace; repeated `keep` public ids retain files |
| DELETE | `/api/v1/pastes/{slug}` | delete one |
| DELETE | `/api/v1/pastes` | purge all |
| GET | `/api/v1/pastes/{slug}/raw` | text body |
| GET | `/api/v1/pastes/{slug}/files/{id}` | stream a file by public id (`?download=1` forces attachment) |
| POST | `/api/v1/pastes/{slug}/reveal` | burn: return payload, delete, `410` after |
| GET | `/api/v1/events` | SSE: `paste.created|updated|deleted|purged` |
| GET | `/api/v1/openapi.json` · `/llms.txt` | the contract, and the primer an agent reads first |

Titles are derived when you do not supply one: the first line of the text, `report.pdf`, `3 images`,
or `crash loop + 1 image`. Search covers titles, filenames and the body, and each hit carries the
fragment it matched on.

## Agent interface

The client binary is `mpaste` (`/usr/bin/paste` is a macOS text utility, so the name cannot be reused).

```bash
mpaste put - -t "build log" --expires 7d     # stdin → URL
mpaste get latest                           # the last paste, text and file list
mpaste ls -q arm64                          # search with match snippets
```

On the host that runs the container, `docker exec -i messer-paste mpaste put -` needs no token;
from anywhere else set `PASTE_URL` and a bearer token (or a service token for an identity-aware proxy).

Expiry is `expires_in` seconds (`0` = never). Burn pastes are capped at 10 MB because the reveal
returns the payload inline.

## On a phone

The app is installable: on iOS, Share → **Add to Home Screen** (iOS 26 opens every added site as a
web app by default). It then runs full screen with its own session, and the app shell is cached, so a
dead network still opens the composer — the archive and the API are never cached, and a new build
offers a reload instead of swapping itself in.

Because iOS has no `share_target`, "send this to Paste" from another app is an iOS **Shortcut**:

1. Shortcuts → New Shortcut → **Receive** `Text` and `URLs` from Share Sheet.
2. Add **Get Contents of URL**: `POST`, the paste host + `/api/v1/pastes`, request body **Form**,
   fields `text` = Shortcut Input, `expires_in` = `86400`.
3. Header `Authorization: Bearer <token>` (the same 0600 token as `mpaste`).
4. Enable **Show in Share Sheet**; give it a name like "Paste it".

For a file, use `Get File` and a `file` form field instead of `text`.

## Deploy

CI builds and publishes `ghcr.io/jakobbjelver/messer-paste`; the deploy runner deploys the `apps` stack. The
service is described in `~/Server/services.yaml` and `compose.apps.yaml`; Caddy proxies
`paste.example.com` to `messer-paste:8080` and never publishes a host port.

## License

Private, single-user tool.
