package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jakobbjelver/messer-paste/internal/settings"
)

type settingsBody struct {
	Items  []settings.Value `json:"items"`
	Groups []string         `json:"groups"`
	Dirty  int              `json:"custom"`
}

func readSettings(t *testing.T, url string) settingsBody {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET settings = %d", res.StatusCode)
	}
	var body settingsBody
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return body
}

func patchSettings(t *testing.T, url string, payload map[string]any) (*http.Response, map[string]any) {
	t.Helper()
	raw, _ := json.Marshal(payload)
	req, _ := http.NewRequest(http.MethodPatch, url, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(res.Body).Decode(&body)
	return res, body
}

func findSetting(items []settings.Value, key string) settings.Value {
	for _, item := range items {
		if item.Key == key {
			return item
		}
	}
	return settings.Value{}
}

func TestSettingsRoundTrip(t *testing.T) {
	ts := newServer(t)
	base := ts.URL + api + "/settings"

	body := readSettings(t, base)
	if len(body.Items) != len(settings.Defs) {
		t.Fatalf("items = %d, want %d", len(body.Items), len(settings.Defs))
	}
	if v := findSetting(body.Items, "max_text_bytes"); v.Source != settings.FromDefault {
		t.Fatalf("max_text_bytes source = %s", v.Source)
	}

	res, patch := patchSettings(t, base, map[string]any{"max_text_bytes": 4096, "burn_enabled": false})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("PATCH = %d %v", res.StatusCode, patch)
	}
	if patch["custom"] != float64(2) {
		t.Fatalf("custom = %v", patch["custom"])
	}

	// The value is in force, not merely stored: /config reports it and the parser obeys it.
	cfg := readConfig(t, ts.URL+api+"/config")
	limits, _ := cfg["limits"].(map[string]any)
	if limits["text"] != float64(4096) {
		t.Fatalf("limits = %v", limits)
	}
	if cfg["burn_enabled"] != false {
		t.Fatalf("burn_enabled = %v", cfg["burn_enabled"])
	}

	// Reset returns the key to its default.
	req, _ := http.NewRequest(http.MethodDelete, base+"/max_text_bytes", nil)
	del, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	del.Body.Close()
	if del.StatusCode != http.StatusOK {
		t.Fatalf("DELETE = %d", del.StatusCode)
	}
	after := readSettings(t, base)
	if v := findSetting(after.Items, "max_text_bytes"); v.Source != settings.FromDefault {
		t.Fatalf("source after reset = %s", v.Source)
	}
}

func TestSettingsRefuseWhatTheyCannotOwn(t *testing.T) {
	ts := newServer(t)
	base := ts.URL + api + "/settings"

	// A boot key is not a preference.
	if res, _ := patchSettings(t, base, map[string]any{"port": ":9999"}); res.StatusCode != http.StatusConflict {
		t.Fatalf("boot key = %d, want 409", res.StatusCode)
	}

	// An unknown key is a 404 that names it.
	res, body := patchSettings(t, base, map[string]any{"nope": 1})
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown key = %d", res.StatusCode)
	}
	if errBody, _ := body["error"].(map[string]any); errBody["field"] != "nope" {
		t.Fatalf("field = %v", errBody["field"])
	}

	// A value out of bounds is a 422 that names the row.
	res, body = patchSettings(t, base, map[string]any{"max_text_bytes": 10})
	if res.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("bounds = %d %v", res.StatusCode, body)
	}
	if errBody, _ := body["error"].(map[string]any); errBody["field"] != "max_text_bytes" {
		t.Fatalf("field = %v", errBody["field"])
	}

	// One bad key in a batch changes nothing at all.
	res, _ = patchSettings(t, base, map[string]any{"max_text_bytes": 4096, "default_visibility": "secret"})
	if res.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("batch with one bad key = %d", res.StatusCode)
	}
	after := readSettings(t, base)
	if v := findSetting(after.Items, "max_text_bytes"); v.Source != settings.FromDefault {
		t.Fatalf("a rejected batch wrote anyway: %s", v.Source)
	}
}

func TestPublicLinksAreOptIn(t *testing.T) {
	ts := newServer(t)

	body := readConfig(t, ts.URL+api+"/config")
	if body["public_links"] != false {
		t.Fatalf("public_links = %v, want false by default", body["public_links"])
	}

	// A public paste is refused while the feature is off, and the refusal names visibility.
	res := post(t, ts, map[string]string{"text": "x", "visibility": "public", "expires_in": "3600"})
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("public while off = %d", res.StatusCode)
	}
	var envelope struct {
		Error struct {
			Code  string `json:"code"`
			Field string `json:"field"`
		} `json:"error"`
	}
	_ = json.NewDecoder(res.Body).Decode(&envelope)
	res.Body.Close()
	if envelope.Error.Code != "E_DISABLED" || envelope.Error.Field != "visibility" {
		t.Fatalf("envelope = %+v", envelope.Error)
	}

	// Turning it on without a host is allowed by the schema but useless; with a host it works.
	if res, _ := patchSettings(t, ts.URL+api+"/settings", map[string]any{
		"public_links": true, "public_host": "pub.example.com",
	}); res.StatusCode != http.StatusOK {
		t.Fatalf("enable = %d", res.StatusCode)
	}
	if cfg := readConfig(t, ts.URL+api+"/config"); cfg["public_links"] != true || cfg["public_host"] != "pub.example.com" {
		t.Fatalf("config after enable = %v", cfg)
	}
}

func TestReadOnlyFreezesWritesButNotSettings(t *testing.T) {
	ts := newServer(t)
	if res, _ := patchSettings(t, ts.URL+api+"/settings", map[string]any{"read_only": true}); res.StatusCode != http.StatusOK {
		t.Fatalf("could not freeze")
	}
	res := post(t, ts, map[string]string{"text": "x", "expires_in": "3600"})
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("write while frozen = %d", res.StatusCode)
	}
	res.Body.Close()
	// The way out stays open, or the switch would be a trap.
	if out, _ := patchSettings(t, ts.URL+api+"/settings", map[string]any{"read_only": false}); out.StatusCode != http.StatusOK {
		t.Fatalf("could not unfreeze: %d", out.StatusCode)
	}
}

// readConfig decodes /api/v1/config.
func readConfig(t *testing.T, url string) map[string]any {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body map[string]any
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return body
}

// post creates a paste with the standard form.
func post(t *testing.T, ts *httptest.Server, fields map[string]string) *http.Response {
	t.Helper()
	buffer, contentType := form(t, fields, "", nil)
	req, _ := http.NewRequest(http.MethodPost, ts.URL+api+"/pastes", buffer)
	req.Header.Set("Content-Type", contentType)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}
