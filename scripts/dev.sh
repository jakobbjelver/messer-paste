#!/usr/bin/env bash
# Both halves of the dev pair, one trap. The Portal action runs this through PM2; a human runs
# `make dev`.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p .dev/data .dev/pastes
export DATA_DIR="${DATA_DIR:-$PWD/.dev/data}"
export PASTE_ROOT="${PASTE_ROOT:-$PWD/.dev/pastes}"
export PORT="${PORT:-:8015}"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

( cd web/app && npm run dev -- --port 3015 ) &
go run ./cmd/messer-paste &
wait
