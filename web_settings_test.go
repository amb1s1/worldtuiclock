package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestPreferencesPersistAndRejectInvalidChanges(t *testing.T) {
	filename := filepath.Join(t.TempDir(), "worldclock", "settings.json")
	want := defaultPreferences()
	got, err := loadPreferences(filename)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("defaults: %+v, %v", got, err)
	}
	want.H24, want.Animations, want.Spring, want.Theme = false, false, "super", "aurora"
	want.FrostedGlass = false
	want.GlassIntensity = 100
	want.ReflectionType = "matte"
	want.Zones = append(want.Zones, savedZone{City: "Tokyo", Zone: "Asia/Tokyo"})
	if err := savePreferences(filename, want); err != nil {
		t.Fatal(err)
	}
	got, err = loadPreferences(filename)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("saved preferences: %+v, %v", got, err)
	}
	tests := []struct {
		name   string
		mutate func(*preferences)
	}{
		{"empty cities", func(p *preferences) { p.Zones = nil }},
		{"unknown zone", func(p *preferences) {
			p.Zones = []savedZone{{City: "Unknown", Zone: "Mars/Olympus"}}
		}},
		{"duplicate city", func(p *preferences) { p.Zones = append(p.Zones, p.Zones[0]) }},
		{"unknown spring", func(p *preferences) { p.Spring = "missing" }},
		{"unknown theme", func(p *preferences) { p.Theme = "missing" }},
		{"negative intensity", func(p *preferences) { p.GlassIntensity = -1 }},
		{"excessive intensity", func(p *preferences) { p.GlassIntensity = 101 }},
		{"unknown reflection", func(p *preferences) { p.ReflectionType = "missing" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			invalid := want
			invalid.Zones = append([]savedZone(nil), want.Zones...)
			tt.mutate(&invalid)
			if err := savePreferences(filename, invalid); err == nil {
				t.Fatal("invalid settings accepted")
			}
		})
	}
	got, err = loadPreferences(filename)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatal("rejected settings overwrote the saved file")
	}
}

func TestSettingsHTTP(t *testing.T) {
	p := defaultPreferences()
	p.GlassIntensity = 100
	data, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name                        string
		method, origin, contentType string
		status                      int
	}{
		{
			name: "save", method: http.MethodPut, origin: "http://127.0.0.1:8787",
			contentType: "application/json", status: http.StatusNoContent,
		},
		{
			name: "foreign page", method: http.MethodPut, origin: "https://example.com",
			contentType: "application/json", status: http.StatusForbidden,
		},
		{
			name: "plain text", method: http.MethodPut, origin: "http://127.0.0.1:8787",
			contentType: "text/plain", status: http.StatusForbidden,
		},
		{name: "read", method: http.MethodGet, status: http.StatusOK},
		{name: "delete", method: http.MethodDelete, status: http.StatusMethodNotAllowed},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := settingsHandler(filepath.Join(t.TempDir(), "settings.json"))
			r := httptest.NewRequest(tt.method, "http://127.0.0.1:8787/api/settings", bytes.NewReader(data))
			r.Header.Set("Origin", tt.origin)
			r.Header.Set("Content-Type", tt.contentType)
			response := httptest.NewRecorder()
			handler(response, r)
			if response.Code != tt.status {
				t.Fatalf("%s: %d, want %d", tt.method, response.Code, tt.status)
			}
		})
	}
}

func TestSettingsRejectsTrailingData(t *testing.T) {
	filename := filepath.Join(t.TempDir(), "settings.json")
	want := defaultPreferences()
	if err := savePreferences(filename, want); err != nil {
		t.Fatal(err)
	}
	changed := defaultPreferences()
	changed.H24 = false
	data, err := json.Marshal(changed)
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name string
		tail string
	}{
		{"second object", "{}"},
		{"second null", "null"},
		{"trailing junk", "invalid"},
		{"oversized trailing whitespace", strings.Repeat(" ", 16384)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPut, "http://127.0.0.1:8787/api/settings",
				strings.NewReader(string(data)+tt.tail))
			r.Header.Set("Origin", "http://127.0.0.1:8787")
			r.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			settingsHandler(filename)(response, r)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status %d, want %d", response.Code, http.StatusBadRequest)
			}
			got, err := loadPreferences(filename)
			if err != nil || !reflect.DeepEqual(got, want) {
				t.Fatalf("rejected request changed preferences: %+v, %v", got, err)
			}
		})
	}
}

func TestPreferencesErrorsPreserveCause(t *testing.T) {
	filename := filepath.Join(t.TempDir(), "settings.json")
	if err := os.WriteFile(filename, []byte("{"), 0600); err != nil {
		t.Fatal(err)
	}
	_, err := loadPreferences(filename)
	var syntaxError *json.SyntaxError
	if !errors.As(err, &syntaxError) || !strings.Contains(err.Error(), "decode preferences") {
		t.Fatalf("expected contextual JSON syntax error, got %v", err)
	}
}
