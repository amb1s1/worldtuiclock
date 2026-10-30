package main

import (
	"math"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

func testModel(t *testing.T) model {
	t.Helper()
	m, err := newModel()
	if err != nil {
		t.Fatal(err)
	}
	m.now = time.Date(2026, 10, 30, 0, 6, 54, 0, time.UTC)
	m.width, m.height = 100, 30
	return m
}

func requireModel(t *testing.T, updated tea.Model) model {
	t.Helper()
	m, ok := updated.(model)
	if !ok {
		t.Fatalf("unexpected model type %T", updated)
	}
	return m
}

func TestNavigationAndSpring(t *testing.T) {
	m := testModel(t)
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyUp})
	m = requireModel(t, updated)
	if m.cursor != 4 || m.y != 0 {
		t.Fatalf("up should wrap immediately and animate later: cursor=%d y=%g", m.cursor, m.y)
	}
	overshot := false
	for i := 0; i < 120; i++ {
		now := m.now.Add(time.Second / _fps)
		updated, cmd := m.Update(tickMsg(now))
		m = requireModel(t, updated)
		if cmd == nil || !m.now.Equal(now) {
			t.Fatal("tick must update shared time and schedule its successor")
		}
		overshot = overshot || m.y > 4
	}
	if !overshot || math.Abs(m.y-4) > 0.001 || math.Abs(m.vy) > 0.001 {
		t.Fatalf("spring did not overshoot and settle: y=%g vy=%g", m.y, m.vy)
	}
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyDown})
	m = requireModel(t, updated)
	if m.cursor != 0 {
		t.Fatal("down should wrap to New York")
	}
	for _, char := range []rune{'j', 'k'} {
		updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{char}})
		m = requireModel(t, updated)
	}
	if m.cursor != 0 {
		t.Fatal("j then k should return to the same city")
	}
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'t'}})
	m = requireModel(t, updated)
	if m.h24 || !strings.Contains(ansi.Strip(m.zoneRow(0, 0)), m.now.In(m.zones[0].location).Format("03:04:05 PM")) {
		t.Fatal("12-hour mode must include AM/PM")
	}
	for _, msg := range []tea.KeyMsg{{Type: tea.KeyRunes, Runes: []rune{'q'}}, {Type: tea.KeyCtrlC}} {
		_, cmd := m.Update(msg)
		if cmd == nil {
			t.Fatal("quit command missing")
		}
		if _, ok := cmd().(tea.QuitMsg); !ok {
			t.Fatal("expected tea.QuitMsg")
		}
	}
}

func TestOffsetsAcrossDST(t *testing.T) {
	m := testModel(t)
	ny, amsterdam := m.zones[0].location, m.zones[2].location
	tests := []struct {
		date string
		want string
	}{
		{"2026-10-24T12:00:00Z", "+6h"},
		{"2026-10-30T00:06:54Z", "+5h"},
		{"2026-11-02T12:00:00Z", "+6h"},
	}
	for _, tt := range tests {
		t.Run(tt.date, func(t *testing.T) {
			now, err := time.Parse(time.RFC3339, tt.date)
			if err != nil {
				t.Fatal(err)
			}
			if got := relativeOffset(now.In(amsterdam), now.In(ny)); got != tt.want {
				t.Fatalf("got %s, want %s", got, tt.want)
			}
		})
	}
	if got := relativeOffset(m.now.In(time.FixedZone("fractional", 20700)), m.now.In(time.UTC)); got != "+5.75h" {
		t.Fatalf("fractional local offsets must not be truncated: %s", got)
	}
}

func TestLayoutAndClockCells(t *testing.T) {
	m := testModel(t)
	for _, size := range [][2]int{{78, 24}, {80, 30}, {120, 40}} {
		for _, h24 := range []bool{true, false} {
			updated, _ := m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
			m = requireModel(t, updated)
			m.h24 = h24
			view := ansi.Strip(m.View())
			if lipgloss.Width(view) != m.width || lipgloss.Height(view) != m.height {
				t.Fatalf("layout %v h24=%v: got %dx%d", size, h24, lipgloss.Width(view), lipgloss.Height(view))
			}
			for _, want := range []string{"WORLD CLOCK", "America/New_York", "↑/k up · ↓/j down · t 12/24h · q quit", "╭", "╮", "╰", "╯"} {
				if !strings.Contains(view, want) {
					t.Fatalf("missing %q", want)
				}
			}
			lines := strings.Split(view, "\n")
			frameWidth := min(84, m.width)
			top, left := (m.height-_minHeight)/2, (m.width-frameWidth)/2
			if strings.Index(lines[top], "╭") != left || strings.Index(lines[top+_minHeight-1], "╰") != left {
				t.Fatalf("frame is not centered at %d,%d", left, top)
			}
			for i := range m.zones {
				row := ansi.Strip(m.zoneRow(i, i))
				if lipgloss.Width(row) != _tableWidth || strings.Contains(row, "\n") {
					t.Fatalf("row %d is not exactly one %d-column line: %q", i, _tableWidth, row)
				}
				rowLine := top + 11 + 2*i
				if !strings.Contains(lines[rowLine], m.zones[i].city) {
					t.Fatalf("zone %d is not on its consecutive row", i)
				}
			}
		}
	}
	for _, size := range [][2]int{{77, 30}, {80, 23}, {10, 3}, {1, 1}} {
		m.width, m.height = size[0], size[1]
		if view := m.View(); lipgloss.Width(view) > m.width || lipgloss.Height(view) > m.height {
			t.Fatalf("small-terminal fallback overflows %v", size)
		}
	}
	for hour := 0; hour < 24; hour++ {
		rawBar := ansi.Strip(dayBar(hour, false))
		if lipgloss.Width(rawBar) != 24 {
			t.Fatalf("bar must have 24 separate hour cells: %q", rawBar)
		}
		bar := []rune(strings.ReplaceAll(rawBar, " ", ""))
		if len(bar) != 24 || bar[hour] != '█' || strings.Count(string(bar), "█") != 1 {
			t.Fatalf("invalid day bar for hour %d: %s", hour, string(bar))
		}
		for h, cell := range bar {
			if h == hour {
				continue
			}
			want := '▮'
			if cell != want {
				t.Fatalf("hour %d: got %c, want %c", h, cell, want)
			}
		}
	}
	for _, second := range []int{54, 55} {
		digits := ansi.Strip(blockTime(m.now.Add(time.Duration(second-54)*time.Second), true))
		if lipgloss.Width(digits) != 35 || lipgloss.Height(digits) != 5 {
			t.Fatal("blinking must preserve the 35×5 hero footprint")
		}
		for row, line := range strings.Split(digits, "\n") {
			colon := string([]rune(line)[10:11])
			want := " "
			if second%2 == 0 && (row == 1 || row == 3) {
				want = "▪"
			}
			if colon != want {
				t.Fatalf("colon second=%d row=%d: %q", second, row, colon)
			}
		}
	}
}
