# API recipes

Curl for every route, with a bearer token from the `0600` secret file (or the service token the
proxy expects). Timestamps are RFC 3339 UTC. Errors are `{"error":{"code","message"}}` with a stable
code. Listings paginate with `?limit=&cursor=` and answer `next_cursor` and `has_more`.

## Write a paste from stdin

```bash
printf 'error log…' | curl -sS -X POST https://paste.example.com/api/v1/pastes \
  -H "Authorization: Bearer $TOKEN" \
  -F title="build log" -F expires_in=86400 -F text=-
```

## Write a paste from a file

```bash
curl -sS -X POST https://paste.example.com/api/v1/pastes \
  -H "Authorization: Bearer $TOKEN" \
  -F title="screenshot" -F expires_in=0 \
  -F file=@shot.png
```

## Read

```bash
curl -sS "https://paste.example.com/api/v1/pastes?limit=1" -H "Authorization: Bearer $TOKEN"
curl -sS https://paste.example.com/api/v1/pastes/<slug>      -H "Authorization: Bearer $TOKEN"
curl -sS https://paste.example.com/api/v1/pastes/<slug>/raw  -H "Authorization: Bearer $TOKEN"
```

## Search

```bash
curl -sS "https://paste.example.com/api/v1/pastes?q=arm64" -H "Authorization: Bearer $TOKEN"
```

Each item carries `match.field` and `match.snippet`; U+0001 and U+0002 wrap the hit.

## Share one paste with someone who has no session

```bash
curl -sS -X POST https://paste.example.com/api/v1/pastes \
  -H "Authorization: Bearer $TOKEN" \
  -F title="share this" -F text=- -F visibility=public -F expires_in=86400 \
  -F password=correct-horse-battery -F max_views=5
```

The link is the public host, `https://pub.example.com/<slug>`. Public links are one switch: with it
off, a public paste is refused `403 E_DISABLED` and the public host serves nothing. That host answers
`GET` on one paste, its `/raw` text and its files, plus `POST /unlock` when a password is set — no
list, no search, no write. A public paste must expire and it cannot burn. Password minimum is 8
characters; `max_views` counts distinct readers (one per IP per hour), and `0` or absent means no cap.

```bash
curl -sS -X POST https://pub.example.com/api/v1/pastes/<slug>/unlock \
  -H 'Content-Type: application/json' -d '{"password":"correct-horse-battery"}'
```

## Burn

```bash
curl -sS -X POST https://paste.example.com/api/v1/pastes/<slug>/reveal -H "Authorization: Bearer $TOKEN"
```

## Delete

```bash
curl -sS -X DELETE https://paste.example.com/api/v1/pastes/<slug> -H "Authorization: Bearer $TOKEN"
curl -sS -X DELETE https://paste.example.com/api/v1/pastes        -H "Authorization: Bearer $TOKEN"
```

## Settings

```bash
curl -sS https://paste.example.com/api/v1/settings      -H "Authorization: Bearer $TOKEN"
curl -sS -X PATCH https://paste.example.com/api/v1/settings -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"max_text_bytes":4194304}'
curl -sS -X DELETE https://paste.example.com/api/v1/settings/max_text_bytes -H "Authorization: Bearer $TOKEN"
```

A write to a key the environment pins answers `409 E_PINNED`; a write while `read_only` is on answers
`409 E_READ_ONLY`, and settings stay writable in that state so the freeze can always be lifted.

## CLI

```bash
mpaste put file.log -t "build log" --expires 7d
mpaste get latest
mpaste ls -q arm64
```

On the host that runs the container, `docker exec -i messer-paste mpaste put -` needs no token.
