# Build the Vite app first: the Go binary embeds web/dist.
FROM node:26-bookworm AS web
WORKDIR /src/web/app
COPY web/app/package*.json ./
RUN npm ci
COPY web/app/ ./
RUN npm run build

FROM golang:1.26-bookworm AS go
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/app/dist ./web/app/dist
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "-s -w -X main.version=${VERSION:-dev}" -o /out/app ./cmd/messer-paste

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=go /out/app /app/messer-paste
ENV PORT=8080 \
    DATA_DIR=/data \
    LOG_FORMAT=json
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app/messer-paste"]
