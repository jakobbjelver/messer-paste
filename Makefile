BINARY  := messer-paste
PKG     := github.com/jakobbjelver/messer-paste
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo none)
DATE    ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
IMAGE   ?= messer-paste:dev
LDFLAGS := -s -w \
	-X main.version=$(VERSION) \
	-X main.commit=$(COMMIT) \
	-X main.built=$(DATE)

.PHONY: all web web-dev web-test build dev test race fmt fmt-check vet lint typecheck check doctor docker clean

all: build

# The binary embeds web/app/dist, so the frontend is built first: `go build` fails without it
# (pattern all:app/dist: no matching files), which is the ordering this target makes explicit.
web:
	cd web/app && { [ -d node_modules ] || npm ci; } && npm run build

web-dev:
	cd web/app && npm run dev

build: web
	go build -trimpath -ldflags '$(LDFLAGS)' -o bin/$(BINARY) ./cmd/messer-paste

dev:
	./scripts/dev.sh

test: web
	go test ./...

race: web
	go test -race ./...

fmt:
	gofmt -w .

fmt-check:
	@out=$$(gofmt -l .); if [ -n "$$out" ]; then echo "gofmt needed:"; echo "$$out"; exit 1; fi

vet: web
	go vet ./...

lint: fmt-check vet

typecheck:
	cd web/app && npx tsc -b --noEmit

check: fmt-check vet race typecheck

doctor:
	DATA_DIR=$${DATA_DIR:-$$PWD/.dev/data} PASTE_ROOT=$${PASTE_ROOT:-$$PWD/.dev/pastes} \
		go run ./cmd/messer-paste doctor

docker:
	docker build -t $(IMAGE) .

clean:
	rm -rf bin web/app/dist web/app/node_modules
