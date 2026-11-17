package settings

import (
	"testing"
)

// env builds the lookup a test needs from a map.
func envOf(pairs map[string]string) func(string) (string, bool) {
	return func(key string) (string, bool) {
		v, ok := pairs[key]
		return v, ok
	}
}

func TestResolveLayers(t *testing.T) {
	stored := map[string]any{"max_text_bytes": int64(4096)}

	// Default only.
	values, err := Resolve(envOf(nil), nil)
	if err != nil {
		t.Fatal(err)
	}
	if v := values["max_text_bytes"]; v.Source != FromDefault || v.Value.(int64) != 2<<20 {
		t.Fatalf("default layer = %+v", v)
	}

	// The database wins over the default.
	values, err = Resolve(envOf(nil), stored)
	if err != nil {
		t.Fatal(err)
	}
	if v := values["max_text_bytes"]; v.Source != FromCustom || v.Value.(int64) != 4096 {
		t.Fatalf("custom layer = %+v", v)
	}

	// The environment wins over the database, and pins the key.
	values, err = Resolve(envOf(map[string]string{"MAX_TEXT_BYTES": "8192"}), stored)
	if err != nil {
		t.Fatal(err)
	}
	if v := values["max_text_bytes"]; v.Source != FromEnv || v.Value.(int64) != 8192 || v.Editable {
		t.Fatalf("env layer = %+v", v)
	}

	// Removing the variable restores the stored value, not the default: the losing layer is kept.
	values, err = Resolve(envOf(nil), stored)
	if err != nil {
		t.Fatal(err)
	}
	if v := values["max_text_bytes"]; v.Source != FromCustom || v.Value.(int64) != 4096 {
		t.Fatalf("restored layer = %+v", v)
	}
}

func TestBootKeysAreNeverEditable(t *testing.T) {
	values, err := Resolve(envOf(nil), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"port", "data_dir", "paste_root"} {
		if values[key].Editable {
			t.Fatalf("%s must not be editable from the page", key)
		}
	}
}

func TestValidation(t *testing.T) {
	cases := []struct {
		key   string
		value any
		ok    bool
	}{
		{"max_text_bytes", int64(1024), true},
		{"max_text_bytes", int64(1023), false},
		{"max_text_bytes", int64(64<<20 + 1), false},
		{"max_text_bytes", "big", false},
		{"burn_enabled", true, true},
		{"burn_enabled", "yes", false},
		{"default_visibility", "public", true},
		{"default_visibility", "secret", false},
		{"unlock_ttl", "7d", true},
		{"unlock_ttl", "nope", false},
		{"expiry_choices", "1h,24h,7d,0", true},
		{"expiry_choices", "1h,forever", false},
		{"public_host", "paste.example.com", true},
	}
	for _, c := range cases {
		def, ok := Lookup(c.key)
		if !ok {
			t.Fatalf("unknown key %s", c.key)
		}
		_, err := Check(def, c.value)
		if c.ok && err != nil {
			t.Errorf("%s=%v should be valid: %v", c.key, c.value, err)
		}
		if !c.ok && err == nil {
			t.Errorf("%s=%v should be rejected", c.key, c.value)
		}
	}
}

func TestDurationSpeaksDays(t *testing.T) {
	for raw, want := range map[string]int64{
		"90m": 5_400_000_000_000,
		"24h": 86_400_000_000_000,
		"7d":  604_800_000_000_000,
		"4w":  2_419_200_000_000_000,
		"0":   0,
	} {
		got, err := Duration(raw)
		if err != nil {
			t.Fatalf("%s: %v", raw, err)
		}
		if int64(got) != want {
			t.Errorf("%s = %d, want %d", raw, int64(got), want)
		}
	}
}

func TestUnknownStoredKeyIsIgnored(t *testing.T) {
	values, err := Resolve(envOf(nil), map[string]any{"from_a_future_version": "x"})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := values["from_a_future_version"]; ok {
		t.Fatal("an unknown key must not appear in the resolved set")
	}
}
