package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type savedZone struct {
	City string `json:"city"`
	Zone string `json:"zone"`
}

type preferences struct {
	ReflectionType  string      `json:"reflectionType"`
	GlassIntensity  int         `json:"glassIntensity"`
	FrostedGlass    bool        `json:"frostedGlass"`
	TemperatureUnit string      `json:"temperatureUnit"`
	H24             bool        `json:"h24"`
	Animations      bool        `json:"animations"`
	Spring          string      `json:"spring"`
	Theme           string      `json:"theme"`
	Zones           []savedZone `json:"zones"`
}

func (p preferences) validate() error {
	switch p.ReflectionType {
	case "frosted", "clear", "liquid", "prism", "matte":
	default:
		return errors.New("choose a valid reflection type")
	}
	if p.GlassIntensity < 0 || p.GlassIntensity > 100 {
		return errors.New("reflection intensity must be between 0 and 100")
	}
	if p.TemperatureUnit != "c" && p.TemperatureUnit != "f" {
		return errors.New("choose Celsius or Fahrenheit")
	}
	if p.Spring != "small" && p.Spring != "medium" && p.Spring != "super" {
		return errors.New("choose a valid spring strength")
	}
	switch p.Theme {
	case "orbit", "aurora", "ember", "glacier", "rose", "mono":
	default:
		return errors.New("choose a valid theme")
	}
	if len(p.Zones) < 1 || len(p.Zones) > 24 {
		return errors.New("keep between 1 and 24 cities")
	}
	seen := make(map[savedZone]struct{}, len(p.Zones))
	for _, zone := range p.Zones {
		length := utf8.RuneCountInString(zone.City)
		if strings.TrimSpace(zone.City) != zone.City || length < 1 || length > 30 ||
			strings.ContainsAny(zone.City, "\r\n\t") {
			return errors.New("city names must contain 1–30 characters on one line")
		}
		if zone.Zone == "" || zone.Zone == "Local" {
			return errors.New("use an IANA time zone")
		}
		if _, err := time.LoadLocation(zone.Zone); err != nil {
			return fmt.Errorf("load time zone %q: %w", zone.Zone, err)
		}
		if _, exists := seen[zone]; exists {
			return fmt.Errorf("%s is already in the clock", zone.City)
		}
		seen[zone] = struct{}{}
	}
	return nil
}

func defaultPreferences() preferences {
	return preferences{
		ReflectionType:  "frosted",
		GlassIntensity:  12,
		FrostedGlass:    true,
		TemperatureUnit: "c",
		H24:             true,
		Animations:      true,
		Spring:          "medium",
		Theme:           "orbit",
		Zones:           defaultZones(),
	}
}

func defaultZones() []savedZone {
	return []savedZone{
		{City: "New York", Zone: "America/New_York"},
		{City: "Los Angeles", Zone: "America/Los_Angeles"},
		{City: "Amsterdam", Zone: "Europe/Amsterdam"},
		{City: "Texas", Zone: "America/Chicago"},
		{City: "Seattle", Zone: "America/Los_Angeles"},
	}
}

func settingsHandler(filename string) http.HandlerFunc {
	var mu sync.Mutex
	return func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.Method == http.MethodPut {
			if r.Header.Get("Origin") != "http://"+r.Host || r.Header.Get("Content-Type") != "application/json" {
				http.Error(w, "Same-origin JSON request required", http.StatusForbidden)
				return
			}
			var p preferences
			decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&p); err != nil {
				http.Error(w, "Invalid settings", http.StatusBadRequest)
				return
			}
			if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
				http.Error(w, "Settings must contain one JSON object", http.StatusBadRequest)
				return
			}
			if err := p.validate(); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if err := savePreferences(filename, p); err != nil {
				log.Printf("save settings request: %v", err)
				http.Error(w, "Could not save settings", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET, PUT")
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		p, err := loadPreferences(filename)
		if err != nil {
			log.Printf("read settings request: %v", err)
			http.Error(w, "Could not read settings.json; check the saved file", http.StatusInternalServerError)
			return
		}
		writeJSON(w, p)
	}
}

func preferencesPath() (string, error) {
	base := os.Getenv("XDG_CONFIG_HOME")
	if !filepath.IsAbs(base) {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("find home directory for preferences: %w", err)
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "worldclock", "settings.json"), nil
}

func loadPreferences(filename string) (preferences, error) {
	data, err := os.ReadFile(filename)
	if errors.Is(err, os.ErrNotExist) {
		return defaultPreferences(), nil
	}
	if err != nil {
		return preferences{}, fmt.Errorf("read preferences: %w", err)
	}
	p := defaultPreferences()
	if err := json.Unmarshal(data, &p); err != nil {
		return preferences{}, fmt.Errorf("decode preferences: %w", err)
	}
	if p.TemperatureUnit == "" {
		p.TemperatureUnit = "c"
	}
	if err := p.validate(); err != nil {
		return preferences{}, fmt.Errorf("validate saved preferences: %w", err)
	}
	return p, nil
}

func savePreferences(filename string, p preferences) error {
	if err := p.validate(); err != nil {
		return fmt.Errorf("validate preferences: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
		return fmt.Errorf("create preferences directory: %w", err)
	}
	file, err := os.CreateTemp(filepath.Dir(filename), ".settings-*.json")
	if err != nil {
		return fmt.Errorf("create preferences file: %w", err)
	}
	defer func() {
		if err := os.Remove(file.Name()); err != nil && !errors.Is(err, os.ErrNotExist) {
			log.Printf("remove temporary preferences file: %v", err)
		}
	}()
	if err := writePreferences(file, p); err != nil {
		return err
	}
	if err := os.Rename(file.Name(), filename); err != nil {
		return fmt.Errorf("replace preferences file: %w", err)
	}
	return nil
}

func writePreferences(file *os.File, p preferences) (err error) {
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			err = errors.Join(err, fmt.Errorf("close preferences file: %w", closeErr))
		}
	}()
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(p); err != nil {
		return fmt.Errorf("encode preferences: %w", err)
	}
	return nil
}
