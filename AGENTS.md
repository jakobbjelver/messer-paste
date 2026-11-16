# AGENTS.md — Messer Paste

{{One sentence: what this is and where it runs.}}

## What this is

{{The product in two or three sentences. Name the user, the job it does and the one thing that is
unusual about it.}}

## Read first

- `PROJECT.yaml` — the machine-readable facts (tier, stack, deploy, ports, exceptions).
- `README.md` — how to run it.
- Skill `messer-paste` — live state, diagnosis ladders and traps.
- {{docs/PLAN.md or .hermes/plans/<file> — the spec for a multi-milestone build.}}

## Layout

| Path | What |
|---|---|
| `cmd/messer-paste/` | entry point |
| `internal/` | domain, httpapi, store, config |
| `web/` | React app, built to `web/dist` and embedded |
| `deploy/` | container and host deploy assets |
| `actions/actions.json` | Portal actions, including the dev server |

## Commands

```bash
make dev        # start the dev server(s)
make test       # unit + integration
make lint       # read-only checks
make typecheck  # tsc / go vet
make build      # deployable artifact
make check      # the full local gate
make doctor     # diagnose the live/local install (--json)
```

Every command is non-interactive and exits non-zero on failure. A command that only works on one
machine is a bug.

## Invariants

- {{A testable rule. Example: The container never mounts the media library.}}
- {{A testable rule. Example: The queue survives restarts and lives on a bind-backed volume.}}
- {{A testable rule. Example: A missing frontend answers 503 and never takes the API down.}}

## Working rules

- Deploy is CI → image → the deploy runner. Never `docker compose` a the deploy runner stack.
- The dev server is started from the Portal action, never from a shell that outlives the session.
- Secrets are `0600` files, never git, never a the deploy runner stack environment.
- Delete the old layer in the same change that ships the new one. No compatibility shims.
- Update `PROJECT.yaml`, this file and the skill in the same PR as a structural change.

## Where the depth is

Skill `messer-paste` — operating the live thing, diagnosis, incidents and references.
Plan: {{path}}.
