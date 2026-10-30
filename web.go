package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

//go:embed web
var _webFiles embed.FS

func runWeb(port int) error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	handler, err := webHandler(cancel)
	if err != nil {
		return fmt.Errorf("initialize web clock: %w", err)
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return fmt.Errorf("listen on local port %d: %w", port, err)
	}
	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("World Clock: http://%s\nPress q in the clock, or Ctrl+C here, to quit.", listener.Addr())
	return serveWeb(ctx, server, listener, 3*time.Second)
}

func webHandler(quit func()) (http.Handler, error) {
	project, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("find project directory: %w", err)
	}
	project, err = filepath.EvalSymlinks(project)
	if err != nil {
		return nil, fmt.Errorf("resolve project directory: %w", err)
	}
	assets, err := fs.Sub(_webFiles, "web")
	if err != nil {
		return nil, fmt.Errorf("open embedded web assets: %w", err)
	}
	mux := http.NewServeMux()
	settingsFile, err := preferencesPath()
	if err != nil {
		return nil, fmt.Errorf("locate settings file: %w", err)
	}
	settings := settingsHandler(settingsFile)
	mux.HandleFunc("GET /api/settings", settings)
	mux.HandleFunc("PUT /api/settings", settings)
	mux.HandleFunc("GET /api/weather", newWeatherService().handler(settingsFile))
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, struct {
			Application string `json:"application"`
			Project     string `json:"project"`
			PID         int    `json:"pid"`
		}{
			Application: "worldclock",
			Project:     project,
			PID:         os.Getpid(),
		})
	})
	mux.HandleFunc("GET /api/zones", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, defaultZones())
	})
	mux.HandleFunc("POST /api/quit", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") != "http://"+r.Host || r.Header.Get("Content-Type") != "application/json" {
			http.Error(w, "Same-origin JSON request required", http.StatusForbidden)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		quit()
	})
	mux.Handle("GET /", http.FileServer(http.FS(assets)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "+
				"font-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'")
		mux.ServeHTTP(w, r)
	}), nil
}

// serveWeb owns the listener and waits for Serve before returning. If draining
// requests exceeds the grace period, Close releases the remaining connections.
func serveWeb(ctx context.Context, server *http.Server, listener net.Listener, grace time.Duration) (err error) {
	defer func() {
		if closeErr := server.Close(); closeErr != nil {
			err = errors.Join(err, fmt.Errorf("close web server: %w", closeErr))
		}
	}()
	result := make(chan error, 1)
	go func() { result <- server.Serve(listener) }()
	select {
	case err := <-result:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve web clock: %w", err)
		}
		return nil
	case <-ctx.Done():
	}
	shutdown, stop := context.WithTimeout(context.Background(), grace)
	defer stop()
	if shutdownErr := server.Shutdown(shutdown); shutdownErr != nil {
		err = fmt.Errorf("shut down web server: %w", shutdownErr)
	}
	if serveErr := <-result; serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
		err = errors.Join(err, fmt.Errorf("serve web clock: %w", serveErr))
	}
	return err
}

func writeJSON(w http.ResponseWriter, value any) {
	data, err := json.Marshal(value)
	if err != nil {
		log.Printf("encode JSON response: %v", err)
		http.Error(w, "Could not encode response", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if _, err := w.Write(append(data, '\n')); err != nil {
		// The response has started; report the failure without writing it again.
		log.Printf("write JSON response: %v", err)
	}
}
