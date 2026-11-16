// Command paste is the machine client: one binary that talks to the API, so an agent never has to
// know the wire format. With PASTE_URL unset it uses the loopback API inside the container, which is
// the path that needs no token.
package main

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type file struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Mime string `json:"mime"`
	Size int64  `json:"size"`
}

type match struct {
	Field   string `json:"field"`
	Snippet string `json:"snippet"`
}

type paste struct {
	Slug      string  `json:"slug"`
	Title     string  `json:"title"`
	Language  string  `json:"language"`
	Kind      string  `json:"kind"`
	TextBytes int64   `json:"text_bytes"`
	FileBytes int64   `json:"file_bytes"`
	FileCount int     `json:"file_count"`
	Views     int64   `json:"views"`
	Burn      bool    `json:"burn"`
	ExpiresAt *string `json:"expires_at"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
	Text      string  `json:"text"`
	Files     []file  `json:"files"`
	Match     *match  `json:"match"`
}

type page struct {
	Items      []paste `json:"items"`
	NextCursor string  `json:"next_cursor"`
	HasMore    bool    `json:"has_more"`
	Total      int     `json:"total"`
	TookMS     int64   `json:"took_ms"`
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "put":
		err = put(os.Args[2:])
	case "get":
		err = get(os.Args[2:])
	case "ls":
		err = list(os.Args[2:])
	case "rm":
		err = remove(os.Args[2:])
	case "open":
		err = open(os.Args[2:])
	case "help", "-h", "--help":
		usage()
		return
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "mpaste:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Print(`mpaste — Messer Paste client

  paste put <file|-> [-t title] [-expires 1h|24h|7d|never] [-burn] [-json]
  paste get <slug|latest> [-json] [-o dir]
  paste ls [-q query] [-limit n] [-json]
  paste rm <slug>
  paste open <slug>

Environment:
  PASTE_URL                default http://127.0.0.1:8080 (inside the container)
  PASTE_TOKEN              bearer token, optional
  PASTE_INSECURE           set to 1 to skip TLS verification (only for https://paste.local)
  PASTE_AUTH_ID      an authenticating proxy service token, optional
  PASTE_AUTH_SECRET
`)
}

func baseURL() string {
	if value := os.Getenv("PASTE_URL"); value != "" {
		return strings.TrimRight(value, "/")
	}
	return "http://127.0.0.1:8080"
}

func do(req *http.Request) (*http.Response, error) {
	if token := os.Getenv("PASTE_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if id := os.Getenv("PASTE_AUTH_ID"); id != "" {
		req.Header.Set("X-Auth-Client-Id", id)
		req.Header.Set("X-Auth-Client-Secret", os.Getenv("PASTE_AUTH_SECRET"))
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if os.Getenv("PASTE_INSECURE") == "1" {
		// Only for https://paste.local, whose certificate is issued by the estate CA.
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec
	}
	return (&http.Client{Timeout: 30 * time.Second, Transport: transport}).Do(req)
}

func url(path string) string { return baseURL() + "/api/v1" + path }

func put(args []string) error {
	flags := flag.NewFlagSet("put", flag.ExitOnError)
	title := flags.String("t", "", "title (derived when empty)")
	titleLong := flags.String("title", "", "title (derived when empty)")
	expires := flags.String("expires", "24h", "1h, 24h, 7d or never")
	burn := flags.Bool("burn", false, "burn after reading")
	asJSON := flags.Bool("json", false, "print the API response")
	flags.Parse(reorder(args))
	if *titleLong != "" {
		*title = *titleLong
	}
	if flags.NArg() != 1 {
		return errors.New("put needs exactly one path, or - for stdin")
	}

	source := flags.Arg(0)
	var name string
	var data []byte
	var err error
	if source == "-" {
		data, err = io.ReadAll(os.Stdin)
		name = "stdin.txt"
	} else {
		data, err = os.ReadFile(source)
		name = filepath.Base(source)
	}
	if err != nil {
		return err
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("title", *title)
	_ = writer.WriteField("expires_in", fmt.Sprint(expiresSeconds(*expires)))
	if *burn {
		_ = writer.WriteField("burn", "1")
	}
	if text, ok := asText(name, data); ok {
		_ = writer.WriteField("text", text)
	} else {
		part, err := writer.CreateFormFile("file", name)
		if err != nil {
			return err
		}
		if _, err := part.Write(data); err != nil {
			return err
		}
	}
	if err := writer.Close(); err != nil {
		return err
	}

	req, _ := http.NewRequest(http.MethodPost, url("/pastes"), body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	res, err := do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		return apiError(res)
	}
	var saved paste
	if err := json.NewDecoder(res.Body).Decode(&saved); err != nil {
		return err
	}
	if *asJSON {
		return printJSON(saved)
	}
	fmt.Printf("%s/%s\n", baseURL(), saved.Slug)
	return nil
}

// asText keeps the common case (logs, config, a code snippet) as the paste's text, so the UI shows a
// highlighted body instead of one opaque attachment.
func asText(name string, data []byte) (string, bool) {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".zip", ".gz", ".tar", ".exe", ".mp4", ".mp3":
		return "", false
	}
	if len(data) > 2<<20 {
		return "", false
	}
	head := data
	if len(head) > 512 {
		head = head[:512]
	}
	if bytes.IndexByte(head, 0) >= 0 {
		return "", false
	}
	return string(data), true
}

func get(args []string) error {
	flags := flag.NewFlagSet("get", flag.ExitOnError)
	asJSON := flags.Bool("json", false, "print the API response")
	out := flags.String("o", "", "write files into this directory")
	flags.Parse(reorder(args))
	if flags.NArg() != 1 {
		return errors.New("get needs a slug or 'latest'")
	}
	slug := flags.Arg(0)
	if slug == "latest" {
		recent, err := fetchPage("", 1)
		if err != nil {
			return err
		}
		if len(recent.Items) == 0 {
			return errors.New("no pastes")
		}
		slug = recent.Items[0].Slug
	}

	req, _ := http.NewRequest(http.MethodGet, url("/pastes/"+slug), nil)
	res, err := do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return apiError(res)
	}
	var detail paste
	if err := json.NewDecoder(res.Body).Decode(&detail); err != nil {
		return err
	}
	if *asJSON {
		return printJSON(detail)
	}
	if detail.Title != "" {
		fmt.Fprintf(os.Stderr, "# %s · %s · %s\n", detail.Title, detail.Slug, detail.UpdatedAt)
	}
	if detail.Text != "" {
		fmt.Print(detail.Text)
		if !strings.HasSuffix(detail.Text, "\n") {
			fmt.Println()
		}
	}
	for _, f := range detail.Files {
		if *out == "" {
			fmt.Fprintf(os.Stderr, "# file %s (%d bytes): %s/pastes/%s/files/%s\n", f.Name, f.Size, baseURL(), detail.Slug, f.ID)
			continue
		}
		if err := download(detail.Slug, f, *out); err != nil {
			return err
		}
		fmt.Fprintf(os.Stderr, "# wrote %s\n", filepath.Join(*out, f.Name))
	}
	return nil
}

func download(slug string, f file, dir string) error {
	req, _ := http.NewRequest(http.MethodGet, url("/pastes/"+slug+"/files/"+f.ID+"?download=1"), nil)
	res, err := do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return apiError(res)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	handle, err := os.Create(filepath.Join(dir, f.Name))
	if err != nil {
		return err
	}
	defer handle.Close()
	_, err = io.Copy(handle, res.Body)
	return err
}

func list(args []string) error {
	flags := flag.NewFlagSet("ls", flag.ExitOnError)
	query := flags.String("q", "", "search title, filenames and text")
	limit := flags.Int("limit", 20, "how many rows")
	asJSON := flags.Bool("json", false, "print the API response")
	flags.Parse(reorder(args))

	result, err := fetchPage(*query, *limit)
	if err != nil {
		return err
	}
	if *asJSON {
		return printJSON(result)
	}
	for _, item := range result.Items {
		fmt.Printf("%s  %-20s %-8s %s\n", item.Slug, item.UpdatedAt, item.Kind, item.Title)
		if item.Match != nil {
			snippet := strings.ReplaceAll(strings.ReplaceAll(item.Match.Snippet, "\x01", "["), "\x02", "]")
			fmt.Printf("          %s: %s\n", item.Match.Field, snippet)
		}
	}
	fmt.Fprintf(os.Stderr, "%d of %d\n", len(result.Items), result.Total)
	return nil
}

func fetchPage(query string, limit int) (page, error) {
	target := fmt.Sprintf("%s?limit=%d", url("/pastes"), limit)
	if query != "" {
		target += "&q=" + queryEscape(query)
	}
	req, _ := http.NewRequest(http.MethodGet, target, nil)
	res, err := do(req)
	if err != nil {
		return page{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return page{}, apiError(res)
	}
	var out page
	err = json.NewDecoder(res.Body).Decode(&out)
	return out, err
}

func remove(args []string) error {
	flags := flag.NewFlagSet("rm", flag.ExitOnError)
	flags.Parse(reorder(args))
	if flags.NArg() != 1 {
		return errors.New("rm needs a slug")
	}
	req, _ := http.NewRequest(http.MethodDelete, url("/pastes/"+flags.Arg(0)), nil)
	res, err := do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		return apiError(res)
	}
	return nil
}

func open(args []string) error {
	if len(args) != 1 {
		return errors.New("open needs a slug")
	}
	fmt.Printf("%s/%s\n", baseURL(), args[0])
	return nil
}

func apiError(res *http.Response) error {
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.NewDecoder(res.Body).Decode(&body)
	if body.Error.Message != "" {
		return fmt.Errorf("%s (%s)", body.Error.Message, body.Error.Code)
	}
	return fmt.Errorf("http %d", res.StatusCode)
}

func printJSON(value any) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func expiresSeconds(value string) int64 {
	switch strings.ToLower(value) {
	case "never", "0", "inf", "forever":
		return 0
	case "1h":
		return 3600
	case "7d":
		return 604800
	default:
		return 86400
	}
}

func queryEscape(value string) string {
	return strings.NewReplacer(" ", "%20", "&", "%26", "#", "%23", "+", "%2B", "?", "%3F").Replace(value)
}

// reorder puts flags before positionals: Go's flag package stops at the first bare argument, and
// people write `paste put - -t title`, not the other way round.
func reorder(args []string) []string {
	var flags, positional []string
	valued := map[string]bool{
		"-t": true, "-title": true, "--title": true,
		"-expires": true, "--expires": true,
		"-q": true, "--q": true,
		"-limit": true, "--limit": true,
		"-o": true, "--o": true,
	}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if strings.HasPrefix(arg, "-") && arg != "-" {
			flags = append(flags, arg)
			if valued[arg] && i+1 < len(args) {
				i++
				flags = append(flags, args[i])
			}
			continue
		}
		positional = append(positional, arg)
	}
	return append(flags, positional...)
}
