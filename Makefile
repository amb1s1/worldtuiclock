PORT ?= 8787
GOLANGCI_LINT_VERSION := v2.15.0
GOLANGCI_LINT := .tools/golangci-lint/$(GOLANGCI_LINT_VERSION)/golangci-lint
.DEFAULT_GOAL := run
.PHONY: run web tui setup test lint fmt

# Start/restart this project's server and show the clock inside Ghostty.
run:
	@node scripts/run.mjs --port=$(PORT)

# Run the same server for a normal web browser.
web:
	@node scripts/run.mjs --web-only --port=$(PORT)

tui:
	@go run .

setup:
	@node scripts/run.mjs --setup-only

# Use a pinned local tool so a different version on PATH cannot break these targets.
# The official installer verifies the downloaded release's checksum.
$(GOLANGCI_LINT):
	@mkdir -p "$(@D)"
	@curl --fail --silent --show-error --location --retry 2 --max-time 60 \
		"https://raw.githubusercontent.com/golangci/golangci-lint/$(GOLANGCI_LINT_VERSION)/install.sh" \
		--output "$(@D)/install.sh"
	@sh "$(@D)/install.sh" -b "$(@D)" "$(GOLANGCI_LINT_VERSION)"

lint: $(GOLANGCI_LINT)
	@"$(GOLANGCI_LINT)" run
	@"$(GOLANGCI_LINT)" fmt --diff --diff-colored=false

fmt: $(GOLANGCI_LINT)
	@"$(GOLANGCI_LINT)" fmt

test:
	@go test ./...
	@go vet ./...
	@node --check web/app.js
	@node --check web/preferences.js
	@node --check web/weather.js
	@node --check web/settings-menu.js
	@node --check web/explore.js
	@node --check scripts/run.mjs
	@node --check scripts/browser.mjs
	@node --check scripts/terminal.mjs
	@node --check scripts/graphics.mjs
	@node --check scripts/clock-browser.mjs
	@node --test scripts/*.test.mjs
