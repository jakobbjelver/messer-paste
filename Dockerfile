# syntax=docker/dockerfile:1
# Build the Vite app first: the Go binary embeds web/app/dist, so `go build` fails without it.
FROM node:22-alpine AS web
WORKDIR /src/web/app
COPY web/app/package.json web/app/package-lock.json ./
RUN npm ci
COPY web/app/ ./
RUN node scripts/gen-version.mjs && npm run build

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/app/dist ./web/app/dist

ARG VERSION=dev
ARG COMMIT=none
ARG BUILD_DATE=unknown
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath \
    -ldflags "-s -w \
      -X main.version=${VERSION} \
      -X main.commit=${COMMIT} \
      -X main.built=${BUILD_DATE}" \
    -o /out/messer-paste ./cmd/messer-paste

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/messer-paste /usr/local/bin/messer-paste
USER nonroot:nonroot
EXPOSE 8080
# The container is never published: Caddy dials messer-paste:8080 on server_network. Metadata sits
# on /data (the SSD configs volume), content on /pastes (the Media bind mount).
ENV PORT=:8080 \
    DATA_DIR=/data \
    PASTE_ROOT=/pastes
ENTRYPOINT ["/usr/local/bin/messer-paste"]
