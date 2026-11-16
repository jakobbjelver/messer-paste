package httpapi

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jakobbjelver/messer-paste/internal/config"
	"github.com/jakobbjelver/messer-paste/internal/paste"
	"github.com/jakobbjelver/messer-paste/internal/store"
)

func newServer(t *testing.T) *httptest.Server {
	t.Helper()
	base := t.TempDir()
	cfg := config.Config{
		DataDir: base + "/data", PasteRoot: base + "/pastes", Listen: ":0",
		MaxText: 2 << 20, MaxFile: 1 << 20, MaxPaste: 4 << 20, MaxBurn: 1 << 20,
	}
	st, err := store.Open(cfg.DataDir + "/state.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	tree, err := paste.NewStorage(cfg.PasteRoot)
	if err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.DiscardHandler)
	hub := NewHub()
	svc := paste.NewService(st, tree, paste.Limits{
		Text: cfg.MaxText, File: cfg.MaxFile, Paste: cfg.MaxPaste, Burn: cfg.MaxBurn,
	}, hub, log)
	srv := New(cfg, svc, st, tree, hub, log)
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts
}

func form(t *testing.T, fields map[string]string, file string, data []byte, mime string) (*bytes.Buffer, string) {
	t.Helper()
	buffer := &bytes.Buffer{}
	writer := multipart.NewWriter(buffer)
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatal(err)
		}
	}
	if file != "" {
		part, err := writer.CreateFormFile("file", file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer, writer.FormDataContentType()
}

func create(t *testing.T, ts *httptest.Server, fields map[string]string, file string, data []byte) paste.Paste {
	t.Helper()
	body, contentType := form(t, fields, file, data, "application/octet-stream")
	res, err := http.Post(ts.URL+"/api/pastes", contentType, body)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		raw, _ := io.ReadAll(res.Body)
		t.Fatalf("create = %d %s", res.StatusCode, raw)
	}
	var p paste.Paste
	if err := json.NewDecoder(res.Body).Decode(&p); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestTextLifecycle(t *testing.T) {
	ts := newServer(t)
	p := create(t, ts, map[string]string{"title": "hello", "text": "const a = 1", "expires_in": "3600"}, "", nil)
	if len(p.Slug) != 8 || p.ExpiresAt == nil {
		t.Fatalf("bad row: %+v", p)
	}

	res, err := http.Get(ts.URL + "/api/pastes/" + p.Slug)
	if err != nil {
		t.Fatal(err)
	}
	var detail paste.Paste
	_ = json.NewDecoder(res.Body).Decode(&detail)
	res.Body.Close()
	if detail.Text != "const a = 1" || detail.Views != 1 {
		t.Fatalf("detail: %+v", detail)
	}

	res, _ = http.Get(ts.URL + "/api/pastes/" + p.Slug + "/raw")
	raw, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if string(raw) != "const a = 1" {
		t.Fatalf("raw = %q", raw)
	}

	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/pastes/"+p.Slug, nil)
	res, _ = http.DefaultClient.Do(req)
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d", res.StatusCode)
	}
}

func TestFileUploadAndUpdate(t *testing.T) {
	ts := newServer(t)
	png := []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("0", 100))
	p := create(t, ts, map[string]string{"title": "shot", "text": ""}, "shot.png", png)
	if p.Kind != "images" || len(p.Files) != 1 || p.Files[0].ID == 0 {
		t.Fatalf("upload: %+v", p)
	}

	res, _ := http.Get(ts.URL + "/api/pastes/" + p.Slug + "/files/" + itoa(p.Files[0].ID))
	if res.Header.Get("Content-Disposition") != "inline" || res.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("headers: %v", res.Header)
	}
	got, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !bytes.Equal(got, png) {
		t.Fatalf("bytes differ: %d vs %d", len(got), len(png))
	}

	body, contentType := form(t, map[string]string{"title": "shot", "text": "a note"}, "", nil, "")
	req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/pastes/"+p.Slug, body)
	req.Header.Set("Content-Type", contentType)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var updated paste.Paste
	_ = json.NewDecoder(res.Body).Decode(&updated)
	res.Body.Close()
	if updated.FileCount != 0 || updated.Kind != "text" {
		t.Fatalf("update kept files: %+v", updated)
	}
}

func TestBurnOnce(t *testing.T) {
	ts := newServer(t)
	p := create(t, ts, map[string]string{"title": "secret", "text": "one read", "burn": "1"}, "", nil)

	res, _ := http.Get(ts.URL + "/api/pastes/" + p.Slug)
	res.Body.Close()
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("burn detail = %d", res.StatusCode)
	}

	res, _ = http.Post(ts.URL+"/api/pastes/"+p.Slug+"/reveal", "application/json", nil)
	var payload paste.Reveal
	_ = json.NewDecoder(res.Body).Decode(&payload)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || payload.Text != "one read" {
		t.Fatalf("reveal = %d %+v", res.StatusCode, payload)
	}

	res, _ = http.Post(ts.URL+"/api/pastes/"+p.Slug+"/reveal", "application/json", nil)
	res.Body.Close()
	if res.StatusCode != http.StatusGone {
		t.Fatalf("second reveal = %d", res.StatusCode)
	}
}

func TestPurgeAndSSE(t *testing.T) {
	ts := newServer(t)
	create(t, ts, map[string]string{"title": "a", "text": "x"}, "", nil)

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/events", nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("content type = %q", res.Header.Get("Content-Type"))
	}

	lines := make(chan string, 64)
	go func() {
		scanner := bufio.NewScanner(res.Body)
		for scanner.Scan() {
			lines <- scanner.Text()
		}
		close(lines)
	}()

	deadline := time.After(3 * time.Second)
	ready := false
	for !ready {
		select {
		case line := <-lines:
			if strings.HasPrefix(line, "event: ready") {
				ready = true
			}
		case <-deadline:
			t.Fatal("no ready event")
		}
	}

	create(t, ts, map[string]string{"title": "b", "text": "y"}, "", nil)

	deadline = time.After(3 * time.Second)
	for {
		select {
		case line, open := <-lines:
			if !open {
				t.Fatal("stream closed")
			}
			if strings.HasPrefix(line, "event: paste.created") {
				return
			}
		case <-deadline:
			t.Fatal("no paste.created event")
		}
	}
}

func itoa(n int64) string {
	return strconv.FormatInt(n, 10)
}
