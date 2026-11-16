package paste

import (
	"strconv"
	"strings"
	"unicode/utf8"
)

const titleLimit = 64

// DeriveTitle is the one rule for a paste the user did not name. It runs on create and on update
// when the title is blank, so the API, the UI and an agent all get the same string.
func DeriveTitle(text string, files []File) string {
	snippet := firstLine(text)
	switch {
	case snippet != "" && len(files) == 0:
		return snippet
	case snippet != "" && len(files) > 0:
		return snippet + " + " + filePhrase(files)
	case len(files) == 1:
		return clipTitle(files[0].Name)
	case len(files) > 1:
		return filePhrase(files)
	default:
		return "Untitled paste"
	}
}

func firstLine(text string) string {
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		line = strings.TrimLeft(line, "#>*-`"+"\t ")
		line = strings.Join(strings.Fields(line), " ")
		if line != "" {
			return clipTitle(line)
		}
	}
	return ""
}

func filePhrase(files []File) string {
	images := 0
	for _, file := range files {
		if strings.HasPrefix(file.Mime, "image/") {
			images++
		}
	}
	others := len(files) - images
	switch {
	case images > 0 && others > 0:
		return plural(images, "image") + ", " + plural(others, "file")
	case images > 0:
		return plural(images, "image")
	default:
		return plural(others, "file")
	}
}

func plural(n int, word string) string {
	if n == 1 {
		return "1 " + word
	}
	return strconv.Itoa(n) + " " + word + "s"
}

func clipTitle(s string) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= titleLimit {
		return s
	}
	runes := []rune(s)
	cut := titleLimit
	for i := cut; i > cut-16 && i > 0; i-- {
		if runes[i] == ' ' {
			cut = i
			break
		}
	}
	return strings.TrimRight(string(runes[:cut]), " ,.;:") + "…"
}
