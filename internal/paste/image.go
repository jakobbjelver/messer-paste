package paste

import (
	"encoding/binary"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"math"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	_ "image/gif"
	_ "image/png"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// ThumbWidths are the sizes a photo is published at. The reader never asks for the original: a 12 MP
// phone photo is 4 MB and the column it fills is 356 px wide on a phone.
var ThumbWidths = []int{1024, 2048}

// thumbSlots bounds how many photos decode at once: one 24 MP decode is ~100 MB of RGBA, and a phone
// can hand us three of them in a single request.
var thumbSlots = make(chan struct{}, 2)

// maxDecodePixels refuses a frame too large to hold in memory (200 MP is ~800 MB decoded).
const maxDecodePixels = 200_000_000

// thumbQuality is the JPEG quality of a derivative. 82 is the knee: a 1024-wide photo lands near
// 120 KB and no one can tell it from the original at display size.
const thumbQuality = 82

// decodable says which images this binary can both measure and resize. Everything else (HEIC, RAW,
// TIFF) is served as uploaded and shown at its own size.
func decodable(mime string) bool {
	switch mime {
	case "image/jpeg", "image/png", "image/gif", "image/webp":
		return true
	}
	return false
}

// thumbFormat is the extension and content type a derivative carries. PNG stays PNG — a
// screenshot's transparency has to survive — and everything else becomes JPEG, because a
// photographic PNG is untransmittable over a phone connection.
func thumbFormat(mime string) (ext, contentType string, ok bool) {
	switch mime {
	case "image/png", "image/gif":
		return ".png", "image/png", true
	case "image/jpeg", "image/webp":
		return ".jpg", "image/jpeg", true
	}
	return "", "", false
}

// ThumbRel places a derivative beside the originals, in a directory the paste's own removal takes
// with it: files/.thumbs/1-IMG_7603@1024.jpg
func ThumbRel(rel string, width int, ext string) string {
	base := strings.TrimSuffix(path.Base(rel), path.Ext(rel))
	return fmt.Sprintf("files/.thumbs/%s@%d%s", base, width, ext)
}

// ThumbList and ParseThumbs are the row's `thumbs` column: a comma list of widths, which is what the
// API and the client read. Hidden state — "assume 2048 exists" — is how a srcset ends up asking for
// a file that was never written.
func ThumbList(widths []int) string {
	parts := make([]string, 0, len(widths))
	for _, width := range widths {
		parts = append(parts, strconv.Itoa(width))
	}
	return strings.Join(parts, ",")
}

func ParseThumbs(value string) []int {
	out := make([]int, 0, 2)
	for _, part := range strings.Split(value, ",") {
		if width, err := strconv.Atoi(strings.TrimSpace(part)); err == nil && width > 0 {
			out = append(out, width)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// HasThumb answers whether this file carries a derivative of that width.
func (f File) HasThumb(width int) bool {
	for _, have := range f.Thumbs {
		if have == width {
			return true
		}
	}
	return false
}

// ThumbType is the derivative's content type, and whether it exists at all. The extension follows
// the mime, so one lookup answers both "may I serve this" and "with which header".
func (f File) ThumbType(width int) (string, bool) {
	if !f.HasThumb(width) {
		return "", false
	}
	_, contentType, ok := thumbFormat(f.Mime)
	return contentType, ok
}

// ImageSize reads the pixel size out of an image header — no decode, no pixels — in the orientation
// the photo is meant to be seen in. A file it cannot measure answers 0, 0.
func ImageSize(filePath string) (int, int) {
	handle, err := os.Open(filePath)
	if err != nil {
		return 0, 0
	}
	defer handle.Close()
	cfg, _, err := image.DecodeConfig(handle)
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 {
		return 0, 0
	}
	// DecodeConfig left the reader mid-stream; the APP1 marker is at the front.
	if _, err := handle.Seek(0, 0); err != nil {
		return cfg.Width, cfg.Height
	}
	// Orientation 5–8 is a quarter turn: the stored pixels are landscape and the viewer is not.
	if o := exifOrientation(handle); o >= 5 && o <= 8 {
		return cfg.Height, cfg.Width
	}
	return cfg.Width, cfg.Height
}

// Thumbs writes one derivative per published width smaller than the source and reports the widths it
// wrote. A picture it cannot decode is not an upload failure: the original still serves.
func (s *Storage) Thumbs(slug, rel, mime string) ([]int, error) {
	ext, _, ok := thumbFormat(mime)
	if !ok || !decodable(mime) {
		return nil, nil
	}
	source := filepath.Join(s.Dir(slug), filepath.FromSlash(rel))
	handle, err := os.Open(source)
	if err != nil {
		return nil, err
	}
	defer handle.Close()

	thumbSlots <- struct{}{}
	defer func() { <-thumbSlots }()

	orientation := exifOrientation(handle)
	if _, err := handle.Seek(0, 0); err != nil {
		return nil, err
	}
	src, _, err := image.Decode(handle)
	if err != nil {
		return nil, err
	}
	bounds := src.Bounds()
	if bounds.Dx()*bounds.Dy() > maxDecodePixels {
		return nil, fmt.Errorf("%d×%d is too large to resize", bounds.Dx(), bounds.Dy())
	}
	sideways := orientation >= 5 && orientation <= 8
	storedWidth, storedHeight := bounds.Dx(), bounds.Dy()
	shownWidth, shownHeight := storedWidth, storedHeight
	if sideways {
		shownWidth, shownHeight = storedHeight, storedWidth
	}

	written := make([]int, 0, len(ThumbWidths))
	for _, width := range ThumbWidths {
		// Never upscale: a 900 px screenshot has no 1024 px version worth inventing.
		if width >= shownWidth {
			continue
		}
		height := int(math.Round(float64(shownHeight) * float64(width) / float64(shownWidth)))
		// Scale along the stored axes first, then turn the small picture: rotating 5.6 M pixels
		// instead of 24 M is the whole point of the order.
		box := image.Rect(0, 0, width, height)
		if sideways {
			box = image.Rect(0, 0, height, width)
		}
		scaled := image.NewRGBA(box)
		draw.CatmullRom.Scale(scaled, box, src, bounds, draw.Src, nil)
		final := oriented(scaled, orientation)
		if err := s.writePicture(slug, ThumbRel(rel, width, ext), final, ext); err != nil {
			return written, err
		}
		written = append(written, width)
	}
	return written, nil
}

// writePicture encodes a derivative into the tree, through a temp file so a half-written image is
// never served as if it were whole.
func (s *Storage) writePicture(slug, rel string, img image.Image, ext string) error {
	dst := filepath.Join(s.Dir(slug), filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".thumb-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	encode := func() error {
		if ext == ".png" {
			return png.Encode(tmp, img)
		}
		return jpeg.Encode(tmp, img, &jpeg.Options{Quality: thumbQuality})
	}
	if err := encode(); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	if err := os.Chmod(name, 0o644); err != nil {
		os.Remove(name)
		return err
	}
	return os.Rename(name, dst)
}

// RemoveThumbs deletes a file's derivatives. It is the other half of Thumbs: a removed attachment
// must not leave a readable picture behind in .thumbs.
func (s *Storage) RemoveThumbs(slug, rel, mime string) {
	ext, _, ok := thumbFormat(mime)
	if !ok {
		return
	}
	for _, width := range ThumbWidths {
		_ = os.Remove(filepath.Join(s.Dir(slug), filepath.FromSlash(ThumbRel(rel, width, ext))))
	}
}

// oriented applies an EXIF orientation to an already-small image. It runs on pixels only when the
// tag says so, and never on the full-resolution frame.
func oriented(src *image.RGBA, orientation int) *image.RGBA {
	if orientation <= 1 || orientation > 8 {
		return src
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	width, height := w, h
	if orientation >= 5 {
		width, height = h, w
	}
	dst := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			var sx, sy int
			switch orientation {
			case 2: // mirrored
				sx, sy = w-1-x, y
			case 3: // upside down
				sx, sy = w-1-x, h-1-y
			case 4: // mirrored upside down
				sx, sy = x, h-1-y
			case 5: // transposed
				sx, sy = y, x
			case 6: // quarter turn clockwise
				sx, sy = y, h-1-x
			case 7: // transversed
				sx, sy = w-1-y, h-1-x
			case 8: // quarter turn anticlockwise
				sx, sy = w-1-y, x
			}
			copy(dst.Pix[dst.PixOffset(x, y):dst.PixOffset(x, y)+4], src.Pix[src.PixOffset(sx, sy):src.PixOffset(sx, sy)+4])
		}
	}
	return dst
}

// exifOrientation is the only EXIF field this service reads: tag 0x0112 in IFD0, which says how far
// to turn the stored pixels. A photo without EXIF answers 1 (upright).
func exifOrientation(handle *os.File) int {
	head := make([]byte, 256<<10)
	n, err := handle.Read(head)
	if err != nil && n == 0 {
		return 1
	}
	head = head[:n]
	// The APP1 segment must start with "Exif\0\0" right after its marker.
	for i := 2; i+10 < len(head); {
		if head[i] != 0xFF {
			i++
			continue
		}
		marker := head[i+1]
		if marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7) {
			i += 2
			continue
		}
		if marker != 0xE1 {
			if i+4 > len(head) {
				return 1
			}
			i += 2 + int(binary.BigEndian.Uint16(head[i+2:i+4]))
			continue
		}
		if i+10 > len(head) || string(head[i+4:i+10]) != "Exif\x00\x00" {
			return 1
		}
		return tiffOrientation(head[i+10:])
	}
	return 1
}

// tiffOrientation walks IFD0 of a TIFF block for the orientation tag.
func tiffOrientation(tiff []byte) int {
	if len(tiff) < 8 {
		return 1
	}
	var order binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 1
	}
	if order.Uint16(tiff[2:4]) != 42 {
		return 1
	}
	offset := int(order.Uint32(tiff[4:8]))
	if offset < 8 || offset+2 > len(tiff) {
		return 1
	}
	count := int(order.Uint16(tiff[offset : offset+2]))
	for entry := 0; entry < count; entry++ {
		at := offset + 2 + entry*12
		if at+12 > len(tiff) {
			return 1
		}
		if order.Uint16(tiff[at:at+2]) != 0x0112 {
			continue
		}
		value := int(order.Uint16(tiff[at+8 : at+10]))
		if value >= 1 && value <= 8 {
			return value
		}
		return 1
	}
	return 1
}
