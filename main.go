// Worldclock displays local times in a terminal or a local web browser.
package main

import (
	"flag"
	"fmt"
	"log"
	"math"
	"os"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/charmbracelet/bubbles/help"
	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/harmonica"
	"github.com/charmbracelet/lipgloss"
)

const (
	_fps                = 30
	_contentWidth       = 76
	_tableWidth         = _contentWidth - 2
	_clockWidth         = _contentWidth - 4
	_minWidth           = 78
	_minHeight          = 24
	_pink               = lipgloss.Color("#FF5F87")
	_purple             = lipgloss.Color("#7D56F4")
	_dim                = lipgloss.Color("#6B6580")
	_night              = lipgloss.Color("#302A43")
	_background         = lipgloss.Color("#1C1728")
	_canvas             = lipgloss.Color("#13101C")
	_selectedBackground = lipgloss.Color("#2A2145")
)

// Styles and glyphs are initialized once and treated as read-only. Lip Gloss
// style methods return copies, so rendering does not mutate these defaults.
var (
	_frameStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(_purple).
			BorderBackground(_canvas).
			Background(_background).
			Padding(1, 3)
	_titleStyle = lipgloss.NewStyle().
			Background(_purple).
			Foreground(lipgloss.Color("#FFFFFF")).
			Bold(true).
			Padding(0, 1)
	_heroStyle          = lipgloss.NewStyle().Foreground(_pink).Background(_background).Bold(true)
	_textStyle          = lipgloss.NewStyle().Foreground(lipgloss.Color("#E3DFED")).Background(_background).Bold(true)
	_dimStyle           = lipgloss.NewStyle().Foreground(_dim).Background(_background)
	_timeStyle          = lipgloss.NewStyle().Foreground(lipgloss.Color("#B8B2CC")).Background(_background).Bold(true)
	_selectedTimeStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("#FFFFFF")).Background(_background).Bold(true)
	_dayStyle           = lipgloss.NewStyle().Foreground(_purple).Background(_background)
	_nightStyle         = lipgloss.NewStyle().Foreground(_night).Background(_background)
	_metadataStyle      = lipgloss.NewStyle().Background(_background).Align(lipgloss.Right)
	_rowStyle           = lipgloss.NewStyle().Background(_background).Width(_tableWidth)
	_tableStyle         = lipgloss.NewStyle().Background(_background).Width(_contentWidth).Align(lipgloss.Center)
	_clockInsetStyle    = lipgloss.NewStyle().Background(_background).Width(_contentWidth).Padding(0, 2)
	_highlightEdgeStyle = lipgloss.NewStyle().Foreground(_selectedBackground).Background(_background)
	_backgroundStyle    = lipgloss.NewStyle().Background(_background)
	_highlightColors    = makeHighlightColors()
)

// Five-row block numerals reproduce the reference's tall clock face.
var _glyphs = map[rune][5]string{
	'0': {"███", "█ █", "█ █", "█ █", "███"},
	'1': {" █ ", "██ ", " █ ", " █ ", "███"},
	'2': {"███", "  █", "███", "█  ", "███"},
	'3': {"███", "  █", "███", "  █", "███"},
	'4': {"█ █", "█ █", "███", "  █", "  █"},
	'5': {"███", "█  ", "███", "  █", "███"},
	'6': {"███", "█  ", "███", "█ █", "███"},
	'7': {"███", "  █", "  █", "  █", "  █"},
	'8': {"███", "█ █", "███", "█ █", "███"},
	'9': {"███", "█ █", "███", "  █", "███"},
	':': {" ", "▪", " ", "▪", " "},
	' ': {" ", " ", " ", " ", " "},
}

var _digitStyles = [...]lipgloss.Style{
	_heroStyle.Foreground(lipgloss.Color("#FF5F87")),
	_heroStyle.Foreground(lipgloss.Color("#EB61A7")),
	_heroStyle.Foreground(lipgloss.Color("#DB63C4")),
	_heroStyle.Foreground(lipgloss.Color("#C665E8")),
	_heroStyle.Foreground(lipgloss.Color("#B064F5")),
	_heroStyle.Foreground(lipgloss.Color("#9D60F7")),
	_heroStyle.Foreground(lipgloss.Color("#8C5AF5")),
	_heroStyle.Foreground(_purple),
}

type keyMap struct {
	Up, Down, Toggle, Quit key.Binding
}

var _keys = keyMap{
	Up:     key.NewBinding(key.WithKeys("up", "k"), key.WithHelp("↑/k", "up")),
	Down:   key.NewBinding(key.WithKeys("down", "j"), key.WithHelp("↓/j", "down")),
	Toggle: key.NewBinding(key.WithKeys("t"), key.WithHelp("t", "12/24h")),
	Quit:   key.NewBinding(key.WithKeys("q", "ctrl+c"), key.WithHelp("q", "quit")),
}

var _ help.KeyMap = keyMap{}

type zone struct {
	city, name string
	location   *time.Location
}

type model struct {
	cursor        int
	y, vy         float64
	spring        harmonica.Spring
	h24           bool
	now           time.Time
	help          help.Model
	zones         []zone
	width, height int
}

type tickMsg time.Time

var _ tea.Model = model{}

func main() {
	if err := run(); err != nil {
		log.Print("worldclock: ", err)
		os.Exit(1)
	}
}

func run() error {
	webMode := flag.Bool("web", false, "serve the graphical clock for a local browser")
	port := flag.Int("port", 8787, "local port for --web (0 selects an available port)")
	flag.Parse()
	if *webMode {
		return runWeb(*port)
	}
	m, err := newModel()
	if err != nil {
		return fmt.Errorf("initialize terminal clock: %w", err)
	}
	if _, err := tea.NewProgram(m, tea.WithAltScreen(), tea.WithFPS(_fps)).Run(); err != nil {
		return fmt.Errorf("run terminal clock: %w", err)
	}
	return nil
}

func (k keyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.Up, k.Down, k.Toggle, k.Quit}
}

func (k keyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{k.ShortHelp()}
}

func newModel() (model, error) {
	defaults := defaultZones()
	zones := make([]zone, 0, len(defaults))
	for _, entry := range defaults {
		location, err := time.LoadLocation(entry.Zone)
		if err != nil {
			return model{}, fmt.Errorf("load %s: %w", entry.Zone, err)
		}
		zones = append(zones, zone{city: entry.City, name: entry.Zone, location: location})
	}
	h := help.New()
	h.ShortSeparator = " · "
	h.Styles.ShortKey = _timeStyle.Bold(true)
	h.Styles.ShortDesc = _dimStyle
	h.Styles.ShortSeparator = _dimStyle
	return model{
		spring: harmonica.NewSpring(harmonica.FPS(_fps), 7.0, 0.6),
		h24:    true,
		now:    time.Now(),
		help:   h,
		zones:  zones,
	}, nil
}

func (m model) Init() tea.Cmd {
	return tick()
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
	case tea.KeyMsg:
		switch {
		case key.Matches(msg, _keys.Quit):
			return m, tea.Quit
		case key.Matches(msg, _keys.Up):
			m.cursor = (m.cursor + len(m.zones) - 1) % len(m.zones)
		case key.Matches(msg, _keys.Down):
			m.cursor = (m.cursor + 1) % len(m.zones)
		case key.Matches(msg, _keys.Toggle):
			m.h24 = !m.h24
		}
	case tickMsg:
		m.now = time.Time(msg)
		m.y, m.vy = m.spring.Update(m.y, m.vy, float64(m.cursor))
		return m, tick()
	}
	return m, nil
}

func (m model) View() string {
	if m.width <= 0 || m.height <= 0 {
		return ""
	}
	if m.width < _minWidth || m.height < _minHeight {
		message := _textStyle.Width(m.width).MaxWidth(m.width).MaxHeight(m.height).
			Render(fmt.Sprintf("Resize to %d×%d\nq quit", _minWidth, _minHeight))
		return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, message, lipgloss.WithWhitespaceBackground(_canvas))
	}
	z := m.zones[m.cursor]
	t := m.now.In(z.location)
	digits := blockTime(t, m.h24)
	city := z.city
	if !m.h24 {
		city += " · " + t.Format("PM")
	}
	metadata := []string{
		_heroStyle.Render(city),
		_dimStyle.Render(t.Format("Mon, Jan 02")),
		_dimStyle.Render(z.name),
	}
	details := _metadataStyle.Width(_clockWidth - lipgloss.Width(digits) - 2).Render(strings.Join(metadata, "\n"))
	hero := lipgloss.JoinHorizontal(lipgloss.Bottom, digits, "  ", details)

	// Keep spring overshoot in its physical state; only clamp the rendered row.
	highlight := max(0, min(len(m.zones)-1, int(math.Round(m.y))))
	// Fixed row centers keep the table still as the spring moves. Half-block
	// edges give the selector equal half-line padding above and below its text.
	rows := make([]string, 2*len(m.zones)+1)
	for i := range rows {
		rows[i] = _rowStyle.Render("")
	}
	for i := range m.zones {
		rows[2*i+1] = m.zoneRow(i, highlight)
	}
	rows[2*highlight] = highlightEdge(true /* top */)
	rows[2*highlight+2] = highlightEdge(false /* top */)
	h := m.help
	h.Width = _clockWidth
	localFormat := "15:04"
	if !m.h24 {
		localFormat = "3:04 PM"
	}
	header := spread(
		_titleStyle.Render("WORLD CLOCK"),
		_dimStyle.Render("local "+m.now.In(time.Local).Format(localFormat)),
	)
	footer := spread(h.View(_keys), _heroStyle.Render("●")+_dimStyle.Render(" live"))
	content := strings.Join([]string{
		_clockInsetStyle.Render(header), "", _clockInsetStyle.Render(hero), "",
		_tableStyle.Render(strings.Join(rows, "\n")), _clockInsetStyle.Render(footer),
	}, "\n")
	// Full padding needs 84 columns. Preserve the 76-column content on smaller
	// terminals by reducing only the horizontal padding (one column at 80).
	padding := min(3, (m.width-_contentWidth-2)/2)
	frame := _frameStyle.Padding(1, padding)
	// Lip Gloss includes horizontal padding in Width, but excludes the border.
	view := frame.Width(_contentWidth + frame.GetHorizontalPadding()).Render(panelBackground(content))
	return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, view, lipgloss.WithWhitespaceBackground(_canvas))
}

func (m model) zoneRow(i, highlight int) string {
	z := m.zones[i]
	t := m.now.In(z.location)
	abbr, _ := t.Zone()
	selected, highlighted := i == m.cursor, i == highlight
	caret := "   "
	cityStyle, clockStyle := _textStyle, _timeStyle
	if selected {
		caret, cityStyle, clockStyle = " › ", _heroStyle, _selectedTimeStyle
	}
	format := "15:04:05"
	if !m.h24 {
		format = "03:04:05 PM"
	}
	column := 1 // The first cell is reserved for the selector's leading edge.
	render := func(style lipgloss.Style, value string) string {
		if !highlighted {
			result := style.Render(value)
			column += lipgloss.Width(result)
			return result
		}
		plain := lipgloss.NewStyle().Width(style.GetWidth()).MaxWidth(style.GetMaxWidth()).Render(value)
		style = style.UnsetWidth().UnsetMaxWidth()
		var result strings.Builder
		for _, char := range plain {
			cell := string(char)
			result.WriteString(cellStyle(style, true, column).Render(cell))
			column += lipgloss.Width(cell)
		}
		return result.String()
	}
	left := render(_heroStyle.Width(3), caret) +
		render(cityStyle.Width(14).MaxWidth(14), z.city) +
		render(_dimStyle.Width(6).MaxWidth(6), abbr) +
		render(clockStyle.Width(12), t.Format(format))
	offset := relativeOffset(t, m.now.In(time.Local))
	if offset == "+0h" {
		offset = "local"
	}
	gap := _tableWidth - 2 - lipgloss.Width(left) - lipgloss.Width(offset) - 1 - 24
	row := left + render(_dimStyle, strings.Repeat(" ", max(1, gap))) +
		render(_dimStyle, offset+" ") + dayBar(t.Hour(), highlighted)
	leading, trailing := _dimStyle.Render(" "), _dimStyle.Render(" ")
	if highlighted {
		leading = _highlightEdgeStyle.Foreground(_pink).Render("▐")
		trailing = _highlightEdgeStyle.Foreground(_highlightColors[_tableWidth-1]).Render("▌")
	}
	return leading + row + trailing
}

func tick() tea.Cmd {
	return tea.Tick(time.Second/_fps, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func blockTime(t time.Time, h24 bool) string {
	format := "15:04:05"
	if !h24 {
		format = "03:04:05"
	}
	digits := t.Format(format)
	if t.Second()%2 != 0 {
		digits = strings.ReplaceAll(digits, ":", " ")
	}
	lines := make([]string, 5)
	for row := range lines {
		var line strings.Builder
		for i, digit := range digits {
			if i > 0 {
				gap := " "
				// Use positions rather than glyphs so blinking never shifts digits.
				if i == 2 || i == 3 || i == 5 || i == 6 {
					gap = "   "
				}
				line.WriteString(_dimStyle.Render(gap))
			}
			line.WriteString(_digitStyles[i].Render(_glyphs[digit][row]))
		}
		lines[row] = line.String()
	}
	return strings.Join(lines, "\n")
}

// Compare UTC offsets at the same instant, so DST and date boundaries are safe.
func relativeOffset(t, local time.Time) string {
	_, zoneOffset := t.Zone()
	_, localOffset := local.Zone()
	hours := float64(zoneOffset-localOffset) / 3600
	return fmt.Sprintf("%+gh", hours)
}

func makeHighlightColors() [_tableWidth]lipgloss.Color {
	var colors [_tableWidth]lipgloss.Color
	from, to := [3]int{0x2A, 0x21, 0x45}, [3]int{0x38, 0x23, 0x32}
	for x := range colors {
		ratio := float64(x) / float64(_tableWidth-1)
		var rgb [3]int
		for channel := range rgb {
			rgb[channel] = int(math.Round(float64(from[channel]) + float64(to[channel]-from[channel])*ratio))
		}
		colors[x] = lipgloss.Color(fmt.Sprintf("#%02X%02X%02X", rgb[0], rgb[1], rgb[2]))
	}
	return colors
}

func cellStyle(style lipgloss.Style, highlighted bool, column int) lipgloss.Style {
	if highlighted {
		return style.Background(_highlightColors[max(0, min(_tableWidth-1, column))])
	}
	return style
}

func highlightEdge(top bool) string {
	left, fill, right := "╭", "▄", "╮"
	if !top {
		left, fill, right = "╰", "▀", "╯"
	}
	var edge strings.Builder
	edge.WriteString(_highlightEdgeStyle.Foreground(_pink).Render(left))
	for column := 1; column < _tableWidth-1; column++ {
		edge.WriteString(_highlightEdgeStyle.Foreground(_highlightColors[column]).Render(fill))
	}
	edge.WriteString(_highlightEdgeStyle.Foreground(_highlightColors[_tableWidth-1]).Render(right))
	return edge.String()
}

func dayBar(hour int, highlighted bool) string {
	var bar strings.Builder
	for h := 0; h < 24; h++ {
		style, cell := _nightStyle, "▮"
		if h >= 6 && h < 18 {
			style, cell = _dayStyle, "▮"
		}
		if h == hour {
			style, cell = _heroStyle, "█"
		}
		bar.WriteString(cellStyle(style, highlighted, _tableWidth-25+h).Render(cell))
	}
	return bar.String()
}

// Align the two ends of a line without allowing either to escape the frame.
func spread(left, right string) string {
	gap := max(1, _clockWidth-lipgloss.Width(left)-lipgloss.Width(right))
	return left + _dimStyle.Render(strings.Repeat(" ", gap)) + right
}

// Joined blocks and the help component insert unstyled spaces. Restore the
// panel background after nested ANSI resets so those spaces don't become holes.
func panelBackground(content string) string {
	prefix := strings.SplitN(_backgroundStyle.Render("\x00"), "\x00", 2)[0]
	if prefix == "" {
		return content
	}
	content = strings.ReplaceAll(content, "\x1b[0m", "\x1b[0m"+prefix)
	content = strings.ReplaceAll(content, "\x1b[49m", prefix)
	return prefix + content + "\x1b[0m"
}
