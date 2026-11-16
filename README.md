# Messer Paste

A minimal pastebin for text, images and files — drop it, paste it, edit it, burn it. Single user,
self-hosted, behind an authenticating proxy at **paste.example.com**.

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
| GET | `/api/pastes` | list (no bodies) |
| POST | `/api/pastes` | create (multipart: `title`, `text`, `language`, `expires_in`, `burn`, `file`) |
| GET | `/api/pastes/{slug}` | detail; `409` for an unrevealed burn paste |
| PUT | `/api/pastes/{slug}` | replace; repeated `keep` ids retain files |
| DELETE | `/api/pastes/{slug}` | delete one |
| DELETE | `/api/pastes` | purge all |
| GET | `/api/pastes/{slug}/raw` | text body |
| GET | `/api/pastes/{slug}/files/{id}` | stream a file (`?download=1` forces attachment) |
| POST | `/api/pastes/{slug}/reveal` | burn: return payload, delete, `410` after |
| GET | `/api/events` | SSE: `paste.created|updated|deleted|purged` |

Expiry is `expires_in` seconds (`0` = never). Burn pastes are capped at 10 MB because the reveal
returns the payload inline.

## Deploy

CI builds and publishes `ghcr.io/jakobbjelver/messer-paste`; the deploy runner deploys the `apps` stack. The
service is described in `~/Server/services.yaml` and `compose.apps.yaml`; Caddy proxies
`paste.example.com` to `messer-paste:8080` and never publishes a host port.

## License

Private, single-user tool.
