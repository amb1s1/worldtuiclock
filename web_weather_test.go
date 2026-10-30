package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestWeatherCacheAndStaleFallback(t *testing.T) {
	var requests atomic.Int32
	var unavailable atomic.Bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if unavailable.Load() {
			http.Error(w, "offline", http.StatusServiceUnavailable)
			return
		}
		if r.URL.Query().Get("longitude") != "-122.3321" {
			t.Errorf("wrong city coordinates: %s", r.URL.RawQuery)
		}
		if err := json.NewEncoder(w).Encode(map[string]any{
			"current": map[string]any{
				"time":           time.Now().Unix(),
				"temperature_2m": 8.9,
				"weather_code":   53,
				"is_day":         0,
			},
		}); err != nil {
			t.Errorf("write weather fixture: %v", err)
		}
	}))
	defer upstream.Close()
	service := newWeatherService()
	service.forecastURL = upstream.URL
	zone := savedZone{City: "Seattle", Zone: "America/Los_Angeles"}
	first, err := service.current(zone)
	if err != nil || first.Code != 53 || first.IsDay || first.TemperatureC != 8.9 {
		t.Fatalf("unexpected weather: %+v, %v", first, err)
	}
	second, err := service.current(zone)
	if err != nil || first != second || requests.Load() != 1 {
		t.Fatal("fresh weather was not cached")
	}
	unavailable.Store(true)
	entry, _ := service.cachedWeather(zone)
	entry.expires = time.Time{}
	service.storeWeather(zone, entry)
	stale, err := service.current(zone)
	if err != nil || !stale.Stale || stale.TemperatureC != first.TemperatureC {
		t.Fatal("recent cached weather should be labeled stale on outage")
	}
	entry, _ = service.cachedWeather(zone)
	entry.value.UpdatedAtUnix = time.Now().Add(-2 * time.Hour).Unix()
	entry.expires = time.Time{}
	service.storeWeather(zone, entry)
	if _, err := service.current(zone); err == nil {
		t.Fatal("old conditions must not be shown indefinitely")
	}
}

func TestWeatherRejectsMissingDataAndUnknownCities(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if _, err := w.Write([]byte(`{"current":{"time":1,"temperature_2m":null,"weather_code":null}}`)); err != nil {
			t.Errorf("write weather fixture: %v", err)
		}
	}))
	defer upstream.Close()
	service := newWeatherService()
	service.forecastURL = upstream.URL
	if _, err := service.current(savedZone{City: "Seattle", Zone: "America/Los_Angeles"}); err == nil {
		t.Fatal("null weather data must not become zero degrees and sunshine")
	}
	handler := service.handler(filepath.Join(t.TempDir(), "settings.json"))
	response := httptest.NewRecorder()
	query := url.Values{"city": {"Other"}, "zone": {"Asia/Tokyo"}}
	handler(response, httptest.NewRequest(http.MethodGet, "/api/weather?"+query.Encode(), nil))
	if response.Code != http.StatusBadRequest {
		t.Fatal("unknown city was accepted")
	}
}

func TestWeatherGeocodingMatchesCityZone(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if _, err := w.Write([]byte(`{"results":[
			{"name":"London","latitude":42.98,"longitude":-81.24,"timezone":"America/Toronto"},
			{"name":"London","latitude":51.5,"longitude":-0.12,"timezone":"Europe/London"}
		]}`)); err != nil {
			t.Errorf("write geocoding fixture: %v", err)
		}
	}))
	defer upstream.Close()
	service := newWeatherService()
	service.geocodingURL = upstream.URL
	location, err := service.locate(context.Background(), savedZone{City: "London", Zone: "Europe/London"})
	if err != nil || location.Longitude != -.12 {
		t.Fatalf("wrong London: %+v, %v", location, err)
	}
}
