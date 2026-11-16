package paste

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Password hashes are argon2id with the parameters encoded in the string, so a future tuning of the
// cost does not invalidate old hashes: verify reads the numbers from the record it was given.
const (
	argonTime    = 1
	argonMemory  = 64 * 1024
	argonThreads = 4
	argonKeyLen  = 32
	saltLen      = 16
)

func b64(raw []byte) string { return base64.RawStdEncoding.EncodeToString(raw) }

// HashPassword returns argon2id$v=19$m=...,t=...,p=...$salt$hash.
func HashPassword(plain string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(plain), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argonMemory, argonTime, argonThreads, b64(salt), b64(key)), nil
}

// VerifyPassword reports whether plain matches encoded. A malformed record is a non-match, never a
// panic: the value comes from the database, not from the caller.
func VerifyPassword(encoded, plain string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 5 || parts[0] != "argon2id" {
		return false
	}
	var memory, timeCost uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[2], "m=%d,t=%d,p=%d", &memory, &timeCost, &threads); err != nil {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(plain), salt, timeCost, memory, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

// The unlock cookie is a signature, not a session: it says "this browser proved the password for
// this slug before <exp>". Nothing is stored server-side, so a restart only invalidates cookies if
// the secret itself changes.
func SignUnlock(secret, slug string, exp int64) string {
	payload := slug + "|" + strconv.FormatInt(exp, 10)
	return payload + "|" + hex.EncodeToString(mac(secret, payload))
}

func VerifyUnlock(secret, value, slug string, now int64) bool {
	parts := strings.Split(value, "|")
	if len(parts) != 3 {
		return false
	}
	if parts[0] != slug {
		return false
	}
	exp, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || exp < now {
		return false
	}
	want := hex.EncodeToString(mac(secret, parts[0]+"|"+parts[1]))
	return hmac.Equal([]byte(want), []byte(parts[2]))
}

func mac(secret, payload string) []byte {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(payload))
	return h.Sum(nil)
}
