package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jakobbjelver/messer-paste/internal/paste"
)

// Hub is the in-process fan-out: every browser on every machine is one subscriber. A slow client
// drops events instead of blocking a writer.
type Hub struct {
	mu   sync.Mutex
	subs map[chan paste.Event]struct{}
	seq  atomic.Uint64
}

func NewHub() *Hub {
	return &Hub{subs: make(map[chan paste.Event]struct{})}
}

func (h *Hub) Publish(event paste.Event) {
	event.At = time.Now().Unix()
	event.ID = h.seq.Add(1)

	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- event:
		default: // slow subscriber: drop this event, keep the stream
		}
	}
}

func (h *Hub) subscribe() (chan paste.Event, func()) {
	ch := make(chan paste.Event, 16)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()

	cancel := func() {
		h.mu.Lock()
		delete(h.subs, ch)
		h.mu.Unlock()
		close(ch)
	}
	return ch, cancel
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	fmt.Fprint(w, "retry: 3000\n")
	fmt.Fprint(w, "event: ready\ndata: {}\n\n")
	flusher.Flush()

	ch, cancel := s.hub.subscribe()
	defer cancel()

	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case event, open := <-ch:
			if !open {
				return
			}
			payload, err := json.Marshal(event)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", event.ID, event.Type, payload)
			flusher.Flush()
		}
	}
}
