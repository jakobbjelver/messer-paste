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
	"strings"
	"testing"
	"time"

	"github.com/jakobbjelver/messer-paste/internal/config"
	"github.com/jakobbjelver/messer-paste/internal/paste"
	"github.com/jakobbjelver/messer-paste/internal/store"
)

const api = "/api/v1"

func newServer(t *testing.T) *httptest.Server {
	t.Helper()
	base := t.TempDir()
	cfg := config.Default()
	cfg.DataDir, cfg.PasteRoot, cfg.Listen = base+"/data", base+"/pastes", ":0"
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

func form(t *testing.T, fields map[string]string, file string, data []byte) (*bytes.Buffer, string) {
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

func create(t *testing.T, ts *httptest.Server, fields map[string]string, file string, data []byte) pasteDTO {
	t.Helper()
	body, contentType := form(t, fields, file, data)
	res, err := http.Post(ts.URL+api+"/pastes", contentType, body)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		raw, _ := io.ReadAll(res.Body)
		t.Fatalf("create = %d %s", res.StatusCode, raw)
	}
	var p pasteDTO
	if err := json.NewDecoder(res.Body).Decode(&p); err != nil {
		t.Fatal(err)
	}
	return p
}

func errorCode(t *testing.T, res *http.Response) string {
	t.Helper()
	defer res.Body.Close()
	var body errorDTO
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return body.Error.Code
}

func TestTextLifecycle(t *testing.T) {
	ts := newServer(t)
	p := create(t, ts, map[string]string{"title": "hello", "text": "const a = 1", "expires_in": "3600"}, "", nil)
	if len(p.Slug) != 8 || p.ExpiresAt == nil {
		t.Fatalf("bad row: %+v", p)
	}
	if _, err := time.Parse(time.RFC3339, p.CreatedAt); err != nil {
		t.Fatalf("created_at is not RFC 3339: %q", p.CreatedAt)
	}
	if _, err := time.Parse(time.RFC3339, *p.ExpiresAt); err != nil {
		t.Fatalf("expires_at is not RFC 3339: %q", *p.ExpiresAt)
	}

	res, err := http.Get(ts.URL + api + "/pastes/" + p.Slug)
	if err != nil {
		t.Fatal(err)
	}
	var detail pasteDTO
	_ = json.NewDecoder(res.Body).Decode(&detail)
	res.Body.Close()
	if detail.Text != "const a = 1" || detail.Views != 1 {
		t.Fatalf("detail: %+v", detail)
	}

	res, _ = http.Get(ts.URL + api + "/pastes/" + p.Slug + "/raw")
	raw, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if string(raw) != "const a = 1" {
		t.Fatalf("raw = %q", raw)
	}

	req, _ := http.NewRequest(http.MethodDelete, ts.URL+api+"/pastes/"+p.Slug, nil)
	res, _ = http.DefaultClient.Do(req)
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d", res.StatusCode)
	}

	res, _ = http.Get(ts.URL + api + "/pastes/" + p.Slug)
	if code := errorCode(t, res); code != "E_NOT_FOUND" {
		t.Fatalf("error code = %q", code)
	}
}

func TestFileUploadAndUpdate(t *testing.T) {
	ts := newServer(t)
	png := []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("0", 100))
	p := create(t, ts, map[string]string{"title": "shot", "text": ""}, "shot.png", png)
	if p.Kind != "images" || len(p.Files) != 1 || p.Files[0].ID == "" {
		t.Fatalf("upload: %+v", p)
	}

	res, _ := http.Get(ts.URL + api + "/pastes/" + p.Slug + "/files/" + p.Files[0].ID)
	if res.Header.Get("Content-Disposition") != "inline" || res.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("headers: %v", res.Header)
	}
	got, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !bytes.Equal(got, png) {
		t.Fatalf("bytes differ: %d vs %d", len(got), len(png))
	}

	body, contentType := form(t, map[string]string{"title": "shot", "text": "a note"}, "", nil)
	req, _ := http.NewRequest(http.MethodPut, ts.URL+api+"/pastes/"+p.Slug, body)
	req.Header.Set("Content-Type", contentType)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var updated pasteDTO
	_ = json.NewDecoder(res.Body).Decode(&updated)
	res.Body.Close()
	if updated.FileCount != 0 || updated.Kind != "text" {
		t.Fatalf("update kept files: %+v", updated)
	}
}

func TestKeepByPublicID(t *testing.T) {
	ts := newServer(t)
	png := []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("0", 40))
	p := create(t, ts, map[string]string{"title": "keep", "text": "with a file"}, "keep.png", png)

	body, contentType := form(t, map[string]string{"title": "keep", "text": "edited", "keep": p.Files[0].ID}, "", nil)
	req, _ := http.NewRequest(http.MethodPut, ts.URL+api+"/pastes/"+p.Slug, body)
	req.Header.Set("Content-Type", contentType)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var updated pasteDTO
	_ = json.NewDecoder(res.Body).Decode(&updated)
	res.Body.Close()
	if updated.FileCount != 1 || len(updated.Files) != 1 || updated.Files[0].ID != p.Files[0].ID {
		t.Fatalf("keep by public id failed: %+v", updated)
	}
}

func TestBurnOnce(t *testing.T) {
	ts := newServer(t)
	p := create(t, ts, map[string]string{"title": "secret", "text": "one read", "burn": "1"}, "", nil)

	res, _ := http.Get(ts.URL + api + "/pastes/" + p.Slug)
	if code := errorCode(t, res); code != "E_BURN_REQUIRED" {
		t.Fatalf("burn detail code = %q", code)
	}

	res, _ = http.Post(ts.URL+api+"/pastes/"+p.Slug+"/reveal", "application/json", nil)
	var payload paste.Reveal
	_ = json.NewDecoder(res.Body).Decode(&payload)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || payload.Text != "one read" {
		t.Fatalf("reveal = %d %+v", res.StatusCode, payload)
	}

	res, _ = http.Post(ts.URL+api+"/pastes/"+p.Slug+"/reveal", "application/json", nil)
	if code := errorCode(t, res); code != "E_GONE" {
		t.Fatalf("second reveal code = %q", code)
	}
}

func TestDerivedTitles(t *testing.T) {
	ts := newServer(t)
	text := create(t, ts, map[string]string{"text": "## deploy log\nmore"}, "", nil)
	if text.Title != "deploy log" {
		t.Fatalf("text title = %q", text.Title)
	}
	one := create(t, ts, map[string]string{"text": ""}, "report.pdf", []byte("%PDF-1.4"))
	if one.Title != "report.pdf" {
		t.Fatalf("file title = %q", one.Title)
	}
	mixed := create(t, ts, map[string]string{"text": "crash loop"}, "a.png", []byte("\x89PNG\r\n\x1a\n"))
	if mixed.Title != "crash loop + 1 image" {
		t.Fatalf("mixed title = %q", mixed.Title)
	}
	kept := create(t, ts, map[string]string{"title": "mine", "text": "x"}, "", nil)
	if kept.Title != "mine" {
		t.Fatalf("explicit title = %q", kept.Title)
	}
}

func TestListAndSearch(t *testing.T) {
	ts := newServer(t)
	create(t, ts, map[string]string{"title": "portal deploy", "text": "the build failed on arm64 because qemu"}, "", nil)
	create(t, ts, map[string]string{"title": "notes", "text": "unrelated words"}, "portal-shot.jpg", []byte("\x89PNG\r\n\x1a\n"))

	res, _ := http.Get(ts.URL + api + "/pastes?limit=1")
	var page listDTO
	_ = json.NewDecoder(res.Body).Decode(&page)
	res.Body.Close()
	if len(page.Items) != 1 || !page.HasMore || page.NextCursor == "" || page.Total != 2 {
		t.Fatalf("page: %+v", page)
	}

	res, _ = http.Get(ts.URL + api + "/pastes?cursor=" + page.NextCursor)
	var second listDTO
	_ = json.NewDecoder(res.Body).Decode(&second)
	res.Body.Close()
	if len(second.Items) != 1 || second.HasMore {
		t.Fatalf("second page: %+v", second)
	}

	cases := []struct{ query, field string }{
		{"arm64", "text"},
		{"deploy", "title"},
		{"shot", "files"},
	}
	for _, c := range cases {
		res, _ = http.Get(ts.URL + api + "/pastes?q=" + c.query)
		var found listDTO
		_ = json.NewDecoder(res.Body).Decode(&found)
		res.Body.Close()
		if len(found.Items) == 0 {
			t.Fatalf("query %q found nothing", c.query)
		}
		match := found.Items[0].Match
		if match == nil || match.Field != c.field {
			t.Fatalf("query %q matched %+v, want %s", c.query, match, c.field)
		}
		if !strings.Contains(match.Snippet, "\x01") {
			t.Fatalf("query %q snippet has no marker: %q", c.query, match.Snippet)
		}
	}
}

func TestIdempotencyKey(t *testing.T) {
	ts := newServer(t)
	body, contentType := form(t, map[string]string{"title": "once", "text": "x"}, "", nil)
	req, _ := http.NewRequest(http.MethodPost, ts.URL+api+"/pastes", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Idempotency-Key", "probe-1")
	first, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var a pasteDTO
	_ = json.NewDecoder(first.Body).Decode(&a)
	first.Body.Close()

	body2, contentType2 := form(t, map[string]string{"title": "once", "text": "x"}, "", nil)
	req2, _ := http.NewRequest(http.MethodPost, ts.URL+api+"/pastes", body2)
	req2.Header.Set("Content-Type", contentType2)
	req2.Header.Set("Idempotency-Key", "probe-1")
	second, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatal(err)
	}
	var b pasteDTO
	_ = json.NewDecoder(second.Body).Decode(&b)
	second.Body.Close()
	if a.Slug != b.Slug {
		t.Fatalf("idempotency created a second paste: %s vs %s", a.Slug, b.Slug)
	}
}

func TestPurgeAndSSE(t *testing.T) {
	ts := newServer(t)
	create(t, ts, map[string]string{"title": "a", "text": "x"}, "", nil)

	req, _ := http.NewRequest(http.MethodGet, ts.URL+api+"/events", nil)
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

// A file added in an update is a new file: it must get its own public id, or the paste page asks
// for /files/ (empty id) and the browser shows a broken image captioned with the filename.
func TestUpdateAddsFileWithPublicID(t *testing.T) {
	ts := newServer(t)
	p := create(t, ts, map[string]string{"title": "no file yet", "text": "text only"}, "", nil)

	body, contentType := form(t, map[string]string{"title": "no file yet", "text": "text only"}, "added.txt", []byte("hello from an update"))
	req, _ := http.NewRequest(http.MethodPut, ts.URL+api+"/pastes/"+p.Slug, body)
	req.Header.Set("Content-Type", contentType)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(res.Body)
		res.Body.Close()
		t.Fatalf("update = %d %s", res.StatusCode, raw)
	}
	var updated pasteDTO
	_ = json.NewDecoder(res.Body).Decode(&updated)
	res.Body.Close()
	if len(updated.Files) != 1 || updated.Files[0].ID == "" {
		t.Fatalf("added file has no public id: %+v", updated.Files)
	}

	res, err = http.Get(ts.URL + api + "/pastes/" + p.Slug + "/files/" + updated.Files[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("file GET = %d", res.StatusCode)
	}
	if got, _ := io.ReadAll(res.Body); string(got) != "hello from an update" {
		t.Fatalf("bytes = %q", got)
	}
}

// Two files in one update collided on UNIQUE(files.paste_id, files.public_id) and answered 500 —
// the sentence the owner saw as "Could not save the paste".
func TestUpdateAddsTwoFiles(t *testing.T) {
	ts := newServer(t)
	p := create(t, ts, map[string]string{"title": "two", "text": "first"}, "", nil)

	buffer := &bytes.Buffer{}
	writer := multipart.NewWriter(buffer)
	_ = writer.WriteField("title", "two")
	_ = writer.WriteField("text", "first")
	for _, name := range []string{"a.scad", "b.png"} {
		part, err := writer.CreateFormFile("file", name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write([]byte("\x89PNG\r\n\x1a\n" + name)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest(http.MethodPut, ts.URL+api+"/pastes/"+p.Slug, buffer)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(res.Body)
		res.Body.Close()
		t.Fatalf("two files = %d %s", res.StatusCode, raw)
	}
	var updated pasteDTO
	_ = json.NewDecoder(res.Body).Decode(&updated)
	res.Body.Close()
	if len(updated.Files) != 2 {
		t.Fatalf("two files: %+v", updated.Files)
	}
	if updated.Files[0].ID == "" || updated.Files[1].ID == "" || updated.Files[0].ID == updated.Files[1].ID {
		t.Fatalf("ids: %+v", updated.Files)
	}
}
