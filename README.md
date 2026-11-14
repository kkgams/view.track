# Track blueprint editor

An SVG track blueprint editor for [GAMS](https://github.com/kkgams/gams).
Original work by [kkgams](https://github.com/kkgams), licensed under [Apache-2.0](LICENSE).

Use the grouped icon toolbar to Draw, Select, Insert or Pan. Shift-click or
box-select points and drag them together. Wheel to pan, Ctrl/Cmd+wheel to zoom,
or use the zoom/fit buttons. Toggle smooth/straight, closed/open, grid and snapping. Undo/redo,
clean preview and GAMS save/load are included. Choose a simple centerline or a
layered road with configurable asphalt, shoulders, outline and center markings.
Appearance is undoable and saved with the blueprint. Saved SVGs embed versioned editor
metadata and also work as ordinary images. No backend or frameworks are needed.

```sh
make open
```

| View | Source → ZIP entry |
| --- | --- |
| `view-track` | `src/views/view-track.js` + `src/*.mjs` → `views/view-track.js` |

The Host supplies runtime APIs, shared widgets and theme styling. The local Project pins published filesystem/layout plugins, UI Services, file chooser Views and theme; no sibling checkout is required.

## Development

Requires Make, Python 3, Node.js 24+, Git, curl, zip, unzip and shasum. No package installation is needed. Host launch currently supports macOS Apple Silicon.

| Command | Purpose |
| --- | --- |
| `make build` | Assemble `build.nosync/views/view-track.js` |
| `make test` | Run native Node tests and check assembled View syntax |
| `make package` | Build incremental `build.nosync/view.track.zip` and `SHA256SUMS` |
| `make open` | Build and open this checkout's `gams.json` in pinned GAMS v3.1.1 |
| `make tools/gams.app` | Download the Host and preserve its accompanying notices |
| `make serve-docs DOCS_PORT=8083` | Preview the pinned wiki independently |
| `make docs` / `make validate-docs` | Build / validate the wiki |
| `make clean` | Remove generated `build.nosync/`, `tools/gams.app` and `tools/gams-release-notices` only |

First launch needs network access. Existing Host downloads are not updated implicitly; macOS security checks remain intact. Clean refuses tracked files or symlinks within its deletion paths and preserves `gams_modules/` and unrelated tools. All build, documentation and temporary output lives under ignored `build.nosync/`.

## Install

Register `views/view-track.js` from `view.track.zip` as `view-track` in your Project's `ui.views`. Use an explicitly tagged release URL with the `#views/view-track.js` selector. Retain `LICENSE` with the View. See [the wiki](docs/index.md) and local `gams.json` for the supporting Unit pins.

The assembled module keeps absolute Host imports at top level. Helpers remain independently testable native modules; do not introduce relative imports in the View entry because the Host loads Views through blob URLs.
