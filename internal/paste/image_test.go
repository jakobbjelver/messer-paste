package paste

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// jpegBytes is a synthetic photo: a gradient, big enough that a derivative is smaller than it.
func jpegBytes(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: uint8(x ^ y), A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 80}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// withOrientation splices an EXIF APP1 segment carrying one orientation tag after the SOI marker.
// Photos straight out of iOS are stored landscape and turned by this tag, so a derivative that
// ignores it is a sideways picture.
func withOrientation(t *testing.T, jpegData []byte, orientation uint16) []byte {
	t.Helper()
	tiff := make([]byte, 8+2+12+4) // header, count, one entry, next-IFD offset
	copy(tiff[0:2], "II")
	binary.LittleEndian.PutUint16(tiff[2:4], 42)
	binary.LittleEndian.PutUint32(tiff[4:8], 8)
	binary.LittleEndian.PutUint16(tiff[8:10], 1)
	binary.LittleEndian.PutUint16(tiff[10:12], 0x0112) // Orientation
	binary.LittleEndian.PutUint16(tiff[12:14], 3)      // SHORT
	binary.LittleEndian.PutUint32(tiff[14:18], 1)
	binary.LittleEndian.PutUint16(tiff[18:20], orientation)
	binary.LittleEndian.PutUint32(tiff[20:24], 0)

	payload := append([]byte("Exif\x00\x00"), tiff...)
	segment := []byte{0xFF, 0xE1}
	length := make([]byte, 2)
	binary.BigEndian.PutUint16(length, uint16(len(payload)+2))
	segment = append(segment, length...)
	segment = append(segment, payload...)

	out := make([]byte, 0, len(jpegData)+len(segment))
	out = append(out, jpegData[:2]...) // SOI
	out = append(out, segment...)
	out = append(out, jpegData[2:]...)
	return out
}

func writeTemp(t *testing.T, dir, name string, data []byte) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestImageSizeReadsHeaderAndHonoursOrientation(t *testing.T) {
	dir := t.TempDir()
	upright := writeTemp(t, dir, "upright.jpg", jpegBytes(t, 640, 480))
	if width, height := ImageSize(upright); width != 640 || height != 480 {
		t.Fatalf("upright = %d×%d, want 640×480", width, height)
	}

	turned := writeTemp(t, dir, "turned.jpg", withOrientation(t, jpegBytes(t, 640, 480), 6))
	if width, height := ImageSize(turned); width != 480 || height != 640 {
		t.Fatalf("orientation 6 = %d×%d, want 480×640 (the quarter turn is part of the size)", width, height)
	}

	notAnImage := writeTemp(t, dir, "notes.txt", []byte("no pixels here"))
	if width, height := ImageSize(notAnImage); width != 0 || height != 0 {
		t.Fatalf("text file = %d×%d, want 0×0", width, height)
	}
}

func TestThumbsWritesEachPublishedWidth(t *testing.T) {
	root := t.TempDir()
	tree, err := NewStorage(root)
	if err != nil {
		t.Fatal(err)
	}
	slug, rel := "ABCDEFGH", "files/1-photo.jpg"
	if err := tree.Prepare(slug); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(tree.Dir(slug), filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(source), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, jpegBytes(t, 3000, 2000), 0o644); err != nil {
		t.Fatal(err)
	}

	widths, err := tree.Thumbs(slug, rel, "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
	if len(widths) != 2 || widths[0] != 1024 || widths[1] != 2048 {
		t.Fatalf("widths = %v, want [1024 2048]", widths)
	}
	for _, width := range widths {
		path := filepath.Join(tree.Dir(slug), filepath.FromSlash(ThumbRel(rel, width, ".jpg")))
		handle, err := os.Open(path)
		if err != nil {
			t.Fatalf("width %d: %v", width, err)
		}
		cfg, _, err := image.DecodeConfig(handle)
		handle.Close()
		if err != nil {
			t.Fatalf("width %d: %v", width, err)
		}
		if cfg.Width != width {
			t.Fatalf("width %d decoded %d px wide", width, cfg.Width)
		}
		if want := int(math.Round(2000 * float64(width) / 3000)); cfg.Height != want {
			t.Fatalf("width %d decoded %d px high, want %d (aspect kept)", width, cfg.Height, want)
		}
	}
}

func TestThumbsNeverUpscales(t *testing.T) {
	tree, slug, rel := seededTree(t, "files/1-small.png", pngBytes(t, 800, 600, false), true)
	widths, err := tree.Thumbs(slug, rel, "image/png")
	if err != nil {
		t.Fatal(err)
	}
	if len(widths) != 0 {
		t.Fatalf("widths = %v, want none: an 800 px picture has no 1024 px version", widths)
	}
	if _, err := os.Stat(filepath.Join(tree.Dir(slug), "files", ".thumbs")); !os.IsNotExist(err) {
		t.Fatalf(".thumbs should not exist, stat err = %v", err)
	}
}

func TestThumbKeepsTransparencyAsPNG(t *testing.T) {
	tree, slug, rel := seededTree(t, "files/1-shot.png", pngBytes(t, 2400, 1200, true), true)
	widths, err := tree.Thumbs(slug, rel, "image/png")
	if err != nil {
		t.Fatal(err)
	}
	if len(widths) != 2 || widths[0] != 1024 || widths[1] != 2048 {
		t.Fatalf("widths = %v, want [1024 2048]", widths)
	}
	handle, err := os.Open(filepath.Join(tree.Dir(slug), filepath.FromSlash(ThumbRel(rel, 1024, ".png"))))
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Close()
	img, err := png.Decode(handle)
	if err != nil {
		t.Fatal(err)
	}
	_, _, _, alpha := img.At(0, 0).RGBA()
	if alpha != 0 {
		t.Fatalf("alpha at the transparent corner = %d, want 0", alpha)
	}
}

func TestThumbSkipsFormatsItCannotDecode(t *testing.T) {
	tree, slug, rel := seededTree(t, "files/1-photo.heic", []byte("not a picture"), true)
	widths, err := tree.Thumbs(slug, rel, "image/heic")
	if err != nil {
		t.Fatalf("an undecodable picture is not an upload failure: %v", err)
	}
	if len(widths) != 0 {
		t.Fatalf("widths = %v, want none", widths)
	}
}

func TestThumbRelKeepsTheSourceName(t *testing.T) {
	if got := ThumbRel("files/2-IMG_7603.jpeg", 1024, ".jpg"); got != "files/.thumbs/2-IMG_7603@1024.jpg" {
		t.Fatalf("ThumbRel = %q", got)
	}
}

func TestThumbListRoundTrips(t *testing.T) {
	if ThumbList(nil) != "" {
		t.Fatalf("empty list should store an empty column")
	}
	values := ParseThumbs(ThumbList([]int{1024, 2048}))
	if len(values) != 2 || values[0] != 1024 || values[1] != 2048 {
		t.Fatalf("round trip = %v", values)
	}
	if ParseThumbs("") != nil || ParseThumbs("nonsense") != nil {
		t.Fatalf("garbage should parse to nothing")
	}
}

func TestThumbsTurnThePictureTheTagAsksFor(t *testing.T) {
	// Stored 3000×2000 with orientation 6: the viewer must see 2000×3000.
	root := t.TempDir()
	tree, err := NewStorage(root)
	if err != nil {
		t.Fatal(err)
	}
	slug, rel := "ABCDEFGH", "files/1-portrait.jpg"
	if err := tree.Prepare(slug); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(tree.Dir(slug), filepath.FromSlash(rel))
	if err := os.WriteFile(path, withOrientation(t, jpegBytes(t, 3000, 2000), 6), 0o644); err != nil {
		t.Fatal(err)
	}
	widths, err := tree.Thumbs(slug, rel, "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
	if len(widths) != 1 || widths[0] != 1024 {
		t.Fatalf("widths = %v, want [1024]: the shown width is 2000, so 2048 is an upscale", widths)
	}
	handle, err := os.Open(filepath.Join(tree.Dir(slug), filepath.FromSlash(ThumbRel(rel, 1024, ".jpg"))))
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Close()
	cfg, _, err := image.DecodeConfig(handle)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Width != 1024 || cfg.Height != 1536 {
		t.Fatalf("derivative = %d×%d, want 1024×1536 (a sideways thumbnail is worse than none)", cfg.Width, cfg.Height)
	}
}

func pngBytes(t *testing.T, width, height int, transparent bool) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			a := uint8(255)
			if transparent && x < width/2 {
				a = 0
			}
			img.Set(x, y, color.NRGBA{R: uint8(x % 255), G: uint8(y % 255), B: 90, A: a})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func seededTree(t *testing.T, rel string, data []byte, prepare bool) (*Storage, string, string) {
	t.Helper()
	root := t.TempDir()
	tree, err := NewStorage(root)
	if err != nil {
		t.Fatal(err)
	}
	slug := "ABCDEFGH"
	if prepare {
		if err := tree.Prepare(slug); err != nil {
			t.Fatal(err)
		}
	}
	path := filepath.Join(tree.Dir(slug), filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return tree, slug, rel
}
