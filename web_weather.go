package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

type weatherLocation struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Name      string  `json:"name"`
	Timezone  string  `json:"timezone"`
}

type currentWeather struct {
	TemperatureC  float64 `json:"temperatureC"`
	Code          int     `json:"code"`
	IsDay         bool    `json:"isDay"`
	UpdatedAtUnix int64   `json:"updatedAt"`
	Location      string  `json:"location"`
	Stale         bool    `json:"stale"`
}

type weatherCacheEntry struct {
	value   currentWeather
	err     error
	expires time.Time
}

type weatherService struct {
	client       *http.Client
	forecastURL  string
	geocodingURL string
	mu           sync.Mutex
	locations    map[savedZone]weatherLocation
	cache        map[savedZone]weatherCacheEntry
	flight       singleflight.Group
}

func newWeatherService() *weatherService {
	return &weatherService{
		client:       &http.Client{Timeout: 8 * time.Second},
		forecastURL:  "https://api.open-meteo.com/v1/forecast",
		geocodingURL: "https://geocoding-api.open-meteo.com/v1/search",
		locations:    defaultWeatherLocations(),
		cache:        make(map[savedZone]weatherCacheEntry),
	}
}

func (s *weatherService) handler(settingsFile string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		zone := savedZone{City: r.URL.Query().Get("city"), Zone: r.URL.Query().Get("zone")}
		p, err := loadPreferences(settingsFile)
		if err != nil {
			log.Printf("read weather city settings: %v", err)
			http.Error(w, "Could not read city settings", http.StatusInternalServerError)
			return
		}
		allowed := false
		for _, saved := range p.Zones {
			if zone == saved {
				allowed = true
				break
			}
		}
		if !allowed {
			http.Error(w, "Choose a city in your clock", http.StatusBadRequest)
			return
		}
		weather, err := s.current(zone)
		if err != nil {
			log.Printf("get weather for %q: %v", zone.City, err)
			http.Error(w, "Weather unavailable", http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, weather)
	}
}

func (s *weatherService) current(zone savedZone) (currentWeather, error) {
	value, err, _ := s.flight.Do(zone.City+"|"+zone.Zone, func() (any, error) {
		cached, exists := s.cachedWeather(zone)
		if exists && time.Now().Before(cached.expires) {
			return cached.value, cached.err
		}
		// A shared fetch outlives individual requests, but is bounded so callers
		// cannot leave provider requests running indefinitely.
		ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
		defer cancel()
		weather, err := s.fetch(ctx, zone)
		ttl := 10 * time.Minute
		if err != nil {
			ttl = time.Minute
			if exists && cached.value.UpdatedAtUnix > 0 &&
				time.Since(time.Unix(cached.value.UpdatedAtUnix, 0)) < time.Hour {
				weather, err = cached.value, nil
				weather.Stale = true
			}
		}
		s.storeWeather(zone, weatherCacheEntry{
			value:   weather,
			err:     err,
			expires: time.Now().Add(ttl),
		})
		return weather, err
	})
	if err != nil {
		return currentWeather{}, err
	}
	weather, ok := value.(currentWeather)
	if !ok {
		return currentWeather{}, fmt.Errorf("unexpected weather result type %T", value)
	}
	return weather, nil
}

func (s *weatherService) fetch(ctx context.Context, zone savedZone) (currentWeather, error) {
	location, err := s.locate(ctx, zone)
	if err != nil {
		return currentWeather{}, fmt.Errorf("resolve weather location: %w", err)
	}
	var result struct {
		Current *struct {
			TimeUnix    int64    `json:"time"`
			Temperature *float64 `json:"temperature_2m"`
			Code        *int     `json:"weather_code"`
			Day         *int     `json:"is_day"`
		} `json:"current"`
	}
	params := url.Values{
		"latitude":      {strconv.FormatFloat(location.Latitude, 'f', 4, 64)},
		"longitude":     {strconv.FormatFloat(location.Longitude, 'f', 4, 64)},
		"current":       {"temperature_2m,weather_code,is_day"},
		"timeformat":    {"unixtime"},
		"timezone":      {"GMT"},
		"forecast_days": {"1"},
	}
	if err := s.getJSON(ctx, s.forecastURL, params, &result); err != nil {
		return currentWeather{}, fmt.Errorf("fetch conditions for %q: %w", zone.City, err)
	}
	c := result.Current
	if c == nil || c.Temperature == nil || c.Code == nil || c.Day == nil || c.TimeUnix == 0 {
		return currentWeather{}, errors.New("weather provider returned incomplete conditions")
	}
	return currentWeather{
		TemperatureC:  *c.Temperature,
		Code:          *c.Code,
		IsDay:         *c.Day == 1,
		UpdatedAtUnix: c.TimeUnix,
		Location:      location.Name,
		Stale:         time.Since(time.Unix(c.TimeUnix, 0)) > 45*time.Minute,
	}, nil
}

func (s *weatherService) locate(ctx context.Context, zone savedZone) (weatherLocation, error) {
	location, ok := s.cachedLocation(zone)
	if ok {
		return location, nil
	}
	if zone.Zone == "Etc/UTC" {
		return location, errors.New("UTC has no weather location")
	}
	var result struct {
		Results []weatherLocation `json:"results"`
	}
	params := url.Values{
		"name":     {zone.City},
		"count":    {"10"},
		"language": {"en"},
		"format":   {"json"},
	}
	if err := s.getJSON(ctx, s.geocodingURL, params, &result); err != nil {
		return location, fmt.Errorf("locate city %q: %w", zone.City, err)
	}
	for _, candidate := range result.Results {
		if canonicalWeatherZone(candidate.Timezone) == canonicalWeatherZone(zone.Zone) {
			s.storeLocation(zone, candidate)
			return candidate, nil
		}
	}
	return location, errors.New("no matching weather location")
}

func (s *weatherService) getJSON(ctx context.Context, address string, params url.Values, out any) (err error) {
	r, err := http.NewRequestWithContext(ctx, http.MethodGet, address+"?"+params.Encode(), nil)
	if err != nil {
		return fmt.Errorf("create weather request: %w", err)
	}
	r.Header.Set("User-Agent", "worldclock/1.0")
	response, err := s.client.Do(r)
	if err != nil {
		return fmt.Errorf("request weather data: %w", err)
	}
	defer func() {
		if closeErr := response.Body.Close(); closeErr != nil {
			err = errors.Join(err, fmt.Errorf("close weather response: %w", closeErr))
		}
	}()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("weather provider returned %d", response.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(out); err != nil {
		return fmt.Errorf("decode weather response: %w", err)
	}
	return nil
}

func (s *weatherService) cachedLocation(zone savedZone) (weatherLocation, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	location, ok := s.locations[zone]
	return location, ok
}

func (s *weatherService) storeLocation(zone savedZone, location weatherLocation) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.locations[zone] = location
}

func (s *weatherService) cachedWeather(zone savedZone) (weatherCacheEntry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.cache[zone]
	return entry, ok
}

func (s *weatherService) storeWeather(zone savedZone, entry weatherCacheEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cache[zone] = entry
}

func canonicalWeatherZone(zone string) string {
	switch zone {
	case "Asia/Calcutta":
		return "Asia/Kolkata"
	case "Europe/Kiev":
		return "Europe/Kyiv"
	case "Asia/Katmandu":
		return "Asia/Kathmandu"
	}
	return zone
}

// Each service owns its initial locations. Texas uses Austin's coordinates and
// label because a region has no single weather observation.
func defaultWeatherLocations() map[savedZone]weatherLocation {
	return map[savedZone]weatherLocation{
		{City: "New York", Zone: "America/New_York"}: {
			Latitude: 40.7128, Longitude: -74.0060, Name: "New York", Timezone: "America/New_York",
		},
		{City: "Los Angeles", Zone: "America/Los_Angeles"}: {
			Latitude: 34.0522, Longitude: -118.2437, Name: "Los Angeles", Timezone: "America/Los_Angeles",
		},
		{City: "Amsterdam", Zone: "Europe/Amsterdam"}: {
			Latitude: 52.3676, Longitude: 4.9041, Name: "Amsterdam", Timezone: "Europe/Amsterdam",
		},
		{City: "Texas", Zone: "America/Chicago"}: {
			Latitude: 30.2672, Longitude: -97.7431, Name: "Austin, TX", Timezone: "America/Chicago",
		},
		{City: "Seattle", Zone: "America/Los_Angeles"}: {
			Latitude: 47.6062, Longitude: -122.3321, Name: "Seattle", Timezone: "America/Los_Angeles",
		},
	}
}
