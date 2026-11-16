package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jakobbjelver/messer-paste/internal/config"
	"github.com/jakobbjelver/messer-paste/internal/paste"
	"github.com/jakobbjelver/messer-paste/internal/store"
)

const publicHost = "pub.test"

func newPublicServer(t *testing.T) *httptest.Server {
	t.Helper()
	base := t.TempDir()
	cfg := config.Config{
		DataDir: base + "/data", PasteRoot: base + "/pastes", Listen: ":0",
		MaxText: 2 << 20, MaxFile: 1 << 20, MaxPaste: 4 << 20, MaxBurn: 1 << 20,
		PublicHost: publicHost, Secret: "test-secret-that-is-long-enough-32",
		PublicRate: 1000, UnlockRate: 1000,
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

// call performs a request as the given host. The private app is the default host of httptest, so
// only the public cases need the override — which is exactly the shape of the feature.
func call(t *testing.T, ts *httptest.Server, method, host, path string, body io.Reader, contentType string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, ts.URL+path, body)
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if host != "" {
		req.Host = host
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

func TestPublicIsInvisibleFromThePrivateHost(t *testing.T) {
	ts := newPublicServer(t)
	created := create(t, ts, map[string]string{
		"title": "public one", "text": "hello world", "visibility": "public", "expires_in": "86400",
	}, "", nil)

	if res := call(t, ts, http.MethodGet, "", api+"/pastes/"+created.Slug, nil, ""); res.StatusCode != http.StatusOK {
		t.Fatalf("private read = %d", res.StatusCode)
	}
	res := call(t, ts, http.MethodGet, publicHost, api+"/pastes/"+created.Slug, nil, "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("public read = %d", res.StatusCode)
	}
	var got pasteDTO
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Text != "hello world" || got.Visibility != "public" {
		t.Fatalf("public body = %+v", got)
	}
}

func TestPublicHostRefusesTheApp(t *testing.T) {
	ts := newPublicServer(t)
	created := create(t, ts, map[string]string{"text": "private", "expires_in": "86400"}, "", nil)

	cases := []struct{ method, path string }{
		{http.MethodGet, api + "/pastes"},
		{http.MethodGet, api + "/events"},
		{http.MethodDelete, api + "/pastes"},
		{http.MethodPut, api + "/pastes/" + created.Slug},
		{http.MethodDelete, api + "/pastes/" + created.Slug},
		{http.MethodPost, api + "/pastes/" + created.Slug + "/reveal"},
	}
	for _, c := range cases {
		if res := call(t, ts, c.method, publicHost, c.path, strings.NewReader(""), "application/json"); res.StatusCode != http.StatusNotFound {
			t.Fatalf("%s %s on the public host = %d, want 404", c.method, c.path, res.StatusCode)
		}
	}
	// A private paste is indistinguishable from a missing one.
	if res := call(t, ts, http.MethodGet, publicHost, api+"/pastes/"+created.Slug, nil, ""); res.StatusCode != http.StatusNotFound {
		t.Fatalf("private paste on the public host = %d, want 404", res.StatusCode)
	}
}

func TestPublicPasswordAndCookie(t *testing.T) {
	ts := newPublicServer(t)
	created := create(t, ts, map[string]string{
		"title": "locked", "text": "the secret", "visibility": "public",
		"expires_in": "86400", "password": "hunter22",
	}, "", nil)

	res := call(t, ts, http.MethodGet, publicHost, api+"/pastes/"+created.Slug, nil, "")
	var locked pasteDTO
	if err := json.NewDecoder(res.Body).Decode(&locked); err != nil {
		t.Fatal(err)
	}
	if !locked.Locked || locked.Text != "" {
		t.Fatalf("locked read = %+v", locked)
	}

	bad := call(t, ts, http.MethodPost, publicHost, api+"/pastes/"+created.Slug+"/unlock",
		strings.NewReader(`{"password":"nope"}`), "application/json")
	if bad.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong password = %d", bad.StatusCode)
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}
	req, _ := http.NewRequest(http.MethodPost, ts.URL+api+"/pastes/"+created.Slug+"/unlock",
		strings.NewReader(`{"password":"hunter22"}`))
	req.Host = publicHost
	req.Header.Set("Content-Type", "application/json")
	ok, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	ok.Body.Close()
	if ok.StatusCode != http.StatusNoContent {
		t.Fatalf("right password = %d", ok.StatusCode)
	}

	read, err := http.NewRequest(http.MethodGet, ts.URL+api+"/pastes/"+created.Slug, nil)
	if err != nil {
		t.Fatal(err)
	}
	read.Host = publicHost
	body, err := client.Do(read)
	if err != nil {
		t.Fatal(err)
	}
	defer body.Body.Close()
	var unlocked pasteDTO
	if err := json.NewDecoder(body.Body).Decode(&unlocked); err != nil {
		t.Fatal(err)
	}
	if unlocked.Text != "the secret" {
		t.Fatalf("after unlock = %+v", unlocked)
	}

	// The cookie is bound to the slug: the same jar must not open another paste.
	other := create(t, ts, map[string]string{
		"text": "other", "visibility": "public", "expires_in": "86400", "password": "hunter22",
	}, "", nil)
	second, _ := http.NewRequest(http.MethodGet, ts.URL+api+"/pastes/"+other.Slug, nil)
	second.Host = publicHost
	mixed, err := client.Do(second)
	if err != nil {
		t.Fatal(err)
	}
	defer mixed.Body.Close()
	var cross pasteDTO
	if err := json.NewDecoder(mixed.Body).Decode(&cross); err != nil {
		t.Fatal(err)
	}
	if !cross.Locked {
		t.Fatal("the unlock cookie leaked across slugs")
	}
}

func TestPublicViewCap(t *testing.T) {
	ts := newPublicServer(t)
	created := create(t, ts, map[string]string{
		"text": "counted", "visibility": "public", "expires_in": "86400", "max_views": "1",
	}, "", nil)

	read := func(ip string) int {
		req, _ := http.NewRequest(http.MethodGet, ts.URL+api+"/pastes/"+created.Slug, nil)
		req.Host = publicHost
		req.Header.Set("X-Real-IP", ip)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		return res.StatusCode
	}
	if code := read("10.0.0.1"); code != http.StatusOK {
		t.Fatalf("first read = %d", code)
	}
	// The same reader refreshing is not a second view.
	if code := read("10.0.0.1"); code != http.StatusOK {
		t.Fatalf("same-ip reread = %d", code)
	}
	if code := read("10.0.0.2"); code != http.StatusGone {
		t.Fatalf("second reader = %d, want 410", code)
	}
}

func TestPublicValidation(t *testing.T) {
	ts := newPublicServer(t)
	cases := []struct {
		name   string
		fields map[string]string
	}{
		{"no expiry", map[string]string{"text": "x", "visibility": "public"}},
		{"burn", map[string]string{"text": "x", "visibility": "public", "expires_in": "86400", "burn": "1"}},
		{"short password", map[string]string{"text": "x", "visibility": "public", "expires_in": "86400", "password": "abc"}},
		{"bad visibility", map[string]string{"text": "x", "visibility": "world"}},
	}
	for _, c := range cases {
		body, contentType := form(t, c.fields, "", nil)
		res := call(t, ts, http.MethodPost, "", api+"/pastes", body, contentType)
		if res.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s = %d, want 400", c.name, res.StatusCode)
		}
	}
}

func TestPublicConfigAndExpiry(t *testing.T) {
	ts := newPublicServer(t)
	res := call(t, ts, http.MethodGet, publicHost, api+"/config", nil, "")
	var cfg struct {
		PublicHost string `json:"public_host"`
	}
	if err := json.NewDecoder(res.Body).Decode(&cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.PublicHost != publicHost {
		t.Fatalf("public_host = %q", cfg.PublicHost)
	}

	created := create(t, ts, map[string]string{
		"text": "short lived", "visibility": "public", "expires_in": "1",
	}, "", nil)
	time.Sleep(1100 * time.Millisecond)
	if res := call(t, ts, http.MethodGet, publicHost, api+"/pastes/"+created.Slug, nil, ""); res.StatusCode != http.StatusGone {
		t.Fatalf("expired public read = %d, want 410", res.StatusCode)
	}
}

func TestPublicRateLimit(t *testing.T) {
	base := t.TempDir()
	cfg := config.Config{
		DataDir: base + "/data", PasteRoot: base + "/pastes", Listen: ":0",
		MaxText: 2 << 20, MaxFile: 1 << 20, MaxPaste: 4 << 20, MaxBurn: 1 << 20,
		PublicHost: publicHost, Secret: "test-secret-that-is-long-enough-32",
		PublicRate: 3, UnlockRate: 1000,
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

	created := create(t, ts, map[string]string{
		"text": "limited", "visibility": "public", "expires_in": "86400",
	}, "", nil)
	codes := make([]int, 0, 4)
	for i := 0; i < 4; i++ {
		req, _ := http.NewRequest(http.MethodGet, ts.URL+api+"/pastes/"+created.Slug, nil)
		req.Host = publicHost
		req.Header.Set("X-Real-IP", "192.0.2.10")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		codes = append(codes, res.StatusCode)
	}
	if codes[0] != http.StatusOK || codes[3] != http.StatusTooManyRequests {
		t.Fatalf("rate limit codes = %v", codes)
	}
}

// The form the SPA posts has to survive round-tripping: what the rail sends is what the store keeps.
func TestVisibilityRoundTrip(t *testing.T) {
	ts := newPublicServer(t)
	created := create(t, ts, map[string]string{
		"text": "kept", "visibility": "public", "expires_in": "3600", "max_views": "5",
	}, "", nil)
	if created.Visibility != "public" || created.MaxViews == nil || *created.MaxViews != 5 {
		t.Fatalf("created = %+v", created)
	}

	body, contentType := form(t, map[string]string{
		"text": "kept", "visibility": "private", "expires_in": "3600",
	}, "", nil)
	req, _ := http.NewRequest(http.MethodPut, ts.URL+api+"/pastes/"+created.Slug, bytes.NewReader(body.Bytes()))
	req.Header.Set("Content-Type", contentType)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var updated pasteDTO
	if err := json.NewDecoder(res.Body).Decode(&updated); err != nil {
		t.Fatal(err)
	}
	if updated.Visibility != "private" || updated.MaxViews != nil {
		t.Fatalf("after going private = %+v", updated)
	}
	if res := call(t, ts, http.MethodGet, publicHost, api+"/pastes/"+created.Slug, nil, ""); res.StatusCode != http.StatusNotFound {
		t.Fatalf("private again on the public host = %d", res.StatusCode)
	}
}

// A validation failure names the control it belongs to, so the client can highlight it.
func TestInvalidNamesTheField(t *testing.T) {
	ts := newPublicServer(t)
	body, contentType := form(t, map[string]string{"text": "x", "visibility": "public"}, "", nil)
	req, _ := http.NewRequest(http.MethodPost, ts.URL+api+"/pastes", body)
	req.Header.Set("Content-Type", contentType)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d", res.StatusCode)
	}
	var envelope struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
			Field   string `json:"field"`
		} `json:"error"`
	}
	if err := json.NewDecoder(res.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Error.Field != "expiry" {
		t.Fatalf("field = %q", envelope.Error.Field)
	}
	if !strings.Contains(envelope.Error.Message, "expire") {
		t.Fatalf("message = %q", envelope.Error.Message)
	}
}

// A viewable file opens; the download route saves it; anything else is always a download.
func TestFileDisposition(t *testing.T) {
	ts := newPublicServer(t)
	pdf := []byte("%PDF-1.4\n%%EOF")
	created := create(t, ts, map[string]string{"title": "doc", "expires_in": "86400"}, "doc.pdf", pdf)
	if len(created.Files) != 1 {
		t.Fatalf("files = %d", len(created.Files))
	}
	id := created.Files[0].ID

	inlineRes := call(t, ts, http.MethodGet, "", api+"/pastes/"+created.Slug+"/files/"+id, nil, "")
	if got := inlineRes.Header.Get("Content-Disposition"); got != "inline" {
		t.Fatalf("view disposition = %q", got)
	}
	saved := call(t, ts, http.MethodGet, "", api+"/pastes/"+created.Slug+"/files/"+id+"?download=1", nil, "")
	if got := saved.Header.Get("Content-Disposition"); !strings.HasPrefix(got, "attachment") {
		t.Fatalf("download disposition = %q", got)
	}

	bin := create(t, ts, map[string]string{"title": "bin", "expires_in": "86400"}, "tool.bin", []byte{0x4d, 0x5a, 0x00, 0x01})
	binID := bin.Files[0].ID
	binRes := call(t, ts, http.MethodGet, "", api+"/pastes/"+bin.Slug+"/files/"+binID, nil, "")
	if got := binRes.Header.Get("Content-Disposition"); !strings.HasPrefix(got, "attachment") {
		t.Fatalf("binary view disposition = %q", got)
	}
}
