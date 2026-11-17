# Messer Paste

A single-user pastebin for text, images and files. One Go binary serves the API and the app; SQLite
holds the metadata and plain files hold the content; every open tab updates over one SSE stream.

It is meant to run behind your own access layer. There are no accounts, no sharing controls and no
tenancy: one person owns the archive, and the proxy in front of it is the door.

|  |  |
|---|---|
| **Paste or drop** | text, images or files — 4 MB per paste, 1 MB per file |
| **Expiry** | an hour, a day, a week, or never |
| **Burn after reading** | one reveal, then the bytes are deleted on every device |
| **Public links** | read-only host, optional password, optional view cap |
| **Edit** | replace the text and the file set in place, same URL |
| **Archive** | search titles, filenames and bodies, with the matching fragment |
| **Live** | a new paste appears in every open tab without polling |
| **Phone** | installable; the shell opens offline, the archive never lies |

## Run

```bash
docker run -d --name paste \
  -p 8080:8080 \
  -v "$PWD/data:/data" \
  -v "$PWD/content:/content" \
  -e PASTE_TOKEN="$(openssl rand -hex 24)" \
  ghcr.io/jakobbjelver/messer-paste:latest
```

Two volumes: `/data` is the SQLite database and the unlock key, `/content` is one directory per paste.
Nothing else is stateful, and the image runs as a non-root user.

Behind a reverse proxy, terminate TLS there and forward to `:8080`. Set `PUBLIC_HOST` to the hostname
that serves read-only links; that host gets a router of its own and answers only `GET /pastes/{slug}`,
`/raw`, `/files/{id}`, `POST /unlock`, `/config` and `/healthz`. Everything else is a 404, including
the archive.

| Variable | Default | |
|---|---|---|
| `PASTE_TOKEN` | — | bearer token for the API; without it, every request is local-only |
| `PUBLIC_HOST` | empty | hostname of the read-only host; unset disables public links |
| `DATA_DIR` | `/data` | SQLite database, WAL and the unlock key |
| `PASTE_ROOT` | `/content` | one directory per slug |

## Build from source

```bash
make dev      # Go API on :8015, Vite on :3015
make build    # bin/messer-paste, SPA embedded
make check    # go vet, tests, and the frontend type check
```

The first run creates `.dev/data` and `.dev/pastes`. `make doctor` checks the database, the content
root, and drift between rows and directories.

## API

`/api/v1`, JSON, cursor paged, bearer token. The contract is `docs/openapi.json`, served live at
`/api/v1/openapi.json`; `docs/llms.txt` is the primer to hand an agent before it touches anything.

| Method | Path | |
|---|---|---|
| `GET` | `/api/v1/pastes` | page or search: `?q=&limit=&cursor=` |
| `POST` | `/api/v1/pastes` | create — multipart, `Idempotency-Key` honoured |
| `GET` | `/api/v1/pastes/{slug}` | detail; `409` for an unrevealed burn paste |
| `PUT` | `/api/v1/pastes/{slug}` | replace; repeated `keep` ids retain files |
| `DELETE` | `/api/v1/pastes/{slug}` | delete one |
| `DELETE` | `/api/v1/pastes` | purge all |
| `GET` | `/api/v1/pastes/{slug}/raw` | the text body |
| `GET` | `/api/v1/pastes/{slug}/files/{id}` | stream a file by public id |
| `POST` | `/api/v1/pastes/{slug}/reveal` | burn: return, delete, `410` after |
| `GET` | `/api/v1/events` | SSE: `created`, `updated`, `deleted`, `purged` |

Titles are derived when you do not supply one: the first line of the text, `report.pdf`, `3 images`,
or `crash loop + 1 image`.

### CLI

`mpaste` is the same binary behind a different name (`/usr/bin/paste` is a macOS utility, so `paste`
cannot be reused).

```bash
mpaste put - -t "build log" --expires 7d     # stdin → URL
mpaste get latest                            # the last paste, text and file list
mpaste ls -q arm64                           # search, with match snippets
```

Inside the container no token is needed; anywhere else set `PASTE_URL` and a token.

## On a phone

Installable: on iOS, Share → **Add to Home Screen**. It runs full screen, keeps its own session, and
the shell is cached, so a dead network still opens the composer. The archive and the API are never
cached — a cached list is a list that lies.

iOS has no `share_target`, so sending something to Paste from another app is an iOS Shortcut: `POST`
multipart to `/api/v1/pastes` with the bearer header, then enable **Show in Share Sheet**.

## Design notes

**Content is not in the database.** Metadata lives in SQLite; every byte of a paste lives in
`<PASTE_ROOT>/<SLUG>/` with the original filename. A paste can be read with `cat`, backed up with
`rsync`, and lost one directory at a time rather than all at once.

**Burn is a tombstone, not a delete.** A reveal returns the payload in the same response that removes
it, and the row keeps a tombstone so a second visitor gets `410` rather than a 404 that suggests they
had the wrong link.

**The public host is a second router, not a second app.** A public paste is readable by anyone with
the link, so it must expire and it cannot burn; a password is an argon2id hash in the row with an
HMAC-signed cookie in the browser, and the view cap counts distinct readers once an hour.

**Realtime is one stream.** `/api/v1/events` carries `created`, `updated`, `deleted` and `purged`;
nothing polls. The stream is the only thing that has to stay open, which is why the app never caches
an API response.

## License

MIT. Not accepting contributions right now.
