SHELL := bash
.ONESHELL:
.SHELLFLAGS := -eu -o pipefail -c
.DELETE_ON_ERROR:
.DEFAULT_GOAL := build

PYTHON ?= python3
NODE ?= node
CURL ?= curl
DOCS_PORT ?= 8083
WIKI_VERSION := v1.8.0
WIKI_REPOSITORY := https://github.com/justgook/wiki
WIKI_MAKEFILE := build.nosync/wiki-$(WIKI_VERSION).mk
WIKI_ENGINE := $(abspath build.nosync/wiki-$(WIKI_VERSION))
GAMS_VERSION := v3.2.0
GAMS_ASSET := GAMS-macos-aarch64.zip
GAMS_RELEASE := https://github.com/kkgams/gams/releases/download/$(GAMS_VERSION)

export TMPDIR := $(abspath build.nosync/tmp)
export XDG_CACHE_HOME := $(abspath build.nosync/cache)
export PYTHONPYCACHEPREFIX := $(abspath build.nosync/pycache)

SOURCES := src/model.mjs src/geometry.mjs src/svg.mjs src/interaction.mjs src/views/view-track.js

.PHONY: build test package open clean docs serve-docs validate-docs
build: build.nosync/views/view-track.js
package: build.nosync/view.track.zip build.nosync/SHA256SUMS

build.nosync/tmp:
	mkdir -p "$@"

build.nosync/views/view-track.js: $(SOURCES) scripts/assemble.py Makefile | build.nosync/tmp
	$(PYTHON) -B scripts/assemble.py

build.nosync/view.track.zip: build.nosync/views/view-track.js LICENSE README.md Makefile
	rm -f "$@"
	cd build.nosync && zip -q -X view.track.zip views/view-track.js
	cd .. && zip -q -X build.nosync/view.track.zip LICENSE README.md

build.nosync/SHA256SUMS: build.nosync/view.track.zip
	cd build.nosync && shasum -a 256 view.track.zip > SHA256SUMS

test: build
	$(NODE) --test test/*.test.mjs
	$(NODE) --check build.nosync/views/view-track.js

# Never update an already downloaded Host or alter macOS quarantine settings.
tools/gams.app: | build.nosync/tmp
	test "$$(uname -s)" = Darwin && test "$$(uname -m)" = arm64 || { echo 'Host download supports macOS Apple Silicon' >&2; exit 1; }
	test ! -e tools/gams-release-notices || { echo 'tools/gams-release-notices already exists' >&2; exit 1; }
	mkdir -p tools
	stage=$$(mktemp -d "$(TMPDIR)/gams-download.XXXXXX")
	trap 'rm -rf "$$stage"' EXIT
	$(CURL) -fLsS "$(GAMS_RELEASE)/$(GAMS_ASSET)" -o "$$stage/$(GAMS_ASSET)"
	$(CURL) -fLsS "$(GAMS_RELEASE)/SHA256SUMS-macos-aarch64" -o "$$stage/SHA256SUMS"
	(cd "$$stage" && shasum -a 256 -c SHA256SUMS)
	unzip -q "$$stage/$(GAMS_ASSET)" -d "$$stage/unpacked"
	test -f "$$stage/unpacked/GAMS.app/Contents/Info.plist"
	test -x "$$stage/unpacked/GAMS.app/Contents/MacOS/gams"
	mv "$$stage/unpacked/GAMS.app" "$$stage/GAMS.app"
	test ! -e "$$stage/unpacked/.gams-managed"
	printf '%s\n' 'view.track Makefile Host download' > "$$stage/unpacked/.gams-managed"
	mv "$$stage/unpacked" tools/gams-release-notices
	mv "$$stage/GAMS.app" "$@"

open: build tools/gams.app
	GAMS_APP_CWD="$(CURDIR)" GAMS_CONFIG="gams.json" GAMS_WASMTIME_CACHE_DIR="$(CURDIR)/build.nosync/host-cache" ./tools/gams.app/Contents/MacOS/gams

$(WIKI_MAKEFILE): | build.nosync/tmp
	mkdir -p "$(@D)"
	trap 'rm -f "$@.tmp"' EXIT
	$(CURL) -fLsS --retry 3 "$(WIKI_REPOSITORY)/raw/$(WIKI_VERSION)/Makefile" -o "$@.tmp"
	mv "$@.tmp" "$@"

docs serve-docs validate-docs: $(WIKI_MAKEFILE) | build.nosync/tmp
	$(MAKE) -f "$(WIKI_MAKEFILE)" "$(if $(filter docs,$@),build,$(patsubst %-docs,%,$@))" WIKI_REPOSITORY="$(WIKI_REPOSITORY)" WIKI_VERSION="$(WIKI_VERSION)" WIKI_ENGINE="$(WIKI_ENGINE)" WIKI_SOURCE="$(abspath docs)" WIKI_OUTPUT="$(abspath build.nosync/docs)" PORT="$(DOCS_PORT)"

clean:
	$(PYTHON) -B scripts/clean.py
