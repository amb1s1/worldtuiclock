package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWebAssetsAndZones(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	handler, err := webHandler(func() {})
	if err != nil {
		t.Fatal(err)
	}
	paths := []string{
		"/", "/app.js", "/preferences.js", "/weather.js", "/settings-menu.js",
		"/explore.js", "/style.css", "/frost.svg", "/fonts/JetBrainsMono-Regular.ttf",
		"/fonts/JetBrainsMono-Bold.ttf", "/fonts/OFL.txt",
	}
	for _, path := range paths {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK || response.Body.Len() == 0 {
			t.Fatalf("missing embedded asset %s: %d", path, response.Code)
		}
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/zones", nil))
	var zones []savedZone
	if err := json.Unmarshal(response.Body.Bytes(), &zones); err != nil {
		t.Fatal(err)
	}
	if len(zones) != 5 || zones[0].City != "New York" || zones[2].Zone != "Europe/Amsterdam" || zones[4].City != "Seattle" {
		t.Fatalf("incorrect default zone order: %+v", zones)
	}
}

func TestWebQuit(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	tests := []struct {
		name, origin, contentType string
		allowed                   bool
	}{
		{
			name: "clock", origin: "http://127.0.0.1:8787",
			contentType: "application/json", allowed: true,
		},
		{name: "foreign page", origin: "https://example.com", contentType: "application/json"},
		{
			name: "form post", origin: "http://127.0.0.1:8787",
			contentType: "application/x-www-form-urlencoded",
		},
		{name: "missing origin", contentType: "application/json"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			quit := false
			handler, err := webHandler(func() { quit = true })
			if err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8787/api/quit", strings.NewReader("{}"))
			r.Header.Set("Origin", tt.origin)
			r.Header.Set("Content-Type", tt.contentType)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, r)
			if quit != tt.allowed {
				t.Fatalf("quit=%v, want %v", quit, tt.allowed)
			}
			want := http.StatusForbidden
			if tt.allowed {
				want = http.StatusNoContent
			}
			if response.Code != want {
				t.Fatalf("status %d, want %d", response.Code, want)
			}
		})
	}
}

func TestWebShutdownDrainsResponse(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		cancel()
		writeJSON(w, map[string]bool{"ok": true})
	})
	address, result := startWebTest(ctx, t, handler, time.Second)
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get(address)
	if err != nil {
		t.Fatal(err)
	}
	data, readErr := io.ReadAll(response.Body)
	closeErr := response.Body.Close()
	if err := errors.Join(readErr, closeErr); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || string(data) != "{\"ok\":true}\n" {
		t.Fatalf("shutdown interrupted the response: status=%d body=%q", response.StatusCode, data)
	}
	if err := <-result; err != nil {
		t.Fatalf("graceful shutdown failed: %v", err)
	}
}

func TestWebShutdownClosesTimedOutConnections(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	handlerStopped := make(chan struct{})
	handler := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		cancel()
		<-r.Context().Done()
		close(handlerStopped)
	})
	address, result := startWebTest(ctx, t, handler, 20*time.Millisecond)
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get(address)
	if err == nil {
		if closeErr := response.Body.Close(); closeErr != nil {
			t.Error(closeErr)
		}
		t.Fatal("expected the timed-out connection to close without a response")
	}
	if err := <-result; !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected preserved shutdown deadline error, got %v", err)
	}
	select {
	case <-handlerStopped:
	case <-time.After(time.Second):
		t.Fatal("forced close did not cancel the active request")
	}
}

func TestJSONResponseEncodingFailure(t *testing.T) {
	response := httptest.NewRecorder()
	writeJSON(response, make(chan int))
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("encoding failure returned %d", response.Code)
	}
	if strings.Contains(response.Header().Get("Content-Type"), "application/json") {
		t.Fatal("encoding failure should not send JSON success headers")
	}
}

func startWebTest(ctx context.Context, t *testing.T, handler http.Handler, grace time.Duration) (string, <-chan error) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: time.Second}
	ctx, cancel := context.WithCancel(ctx)
	result := make(chan error, 1)
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		result <- serveWeb(ctx, server, listener, grace)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-finished:
		case <-time.After(3 * time.Second):
			if err := server.Close(); err != nil {
				t.Errorf("close test server: %v", err)
			}
			t.Error("test server did not finish shutting down")
		}
	})
	return "http://" + listener.Addr().String(), result
}
