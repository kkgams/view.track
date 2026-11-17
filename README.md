# Track blueprint editor

An SVG racing-circuit blueprint editor for [GAMS](https://github.com/kkgams/gams).
Build multiple independent roads, open or looped. Split at a selected point.
Click open endpoints to connect roads while keeping both points; drag endpoints
together to weld them into one point. Deselect and click empty space to start a new road. Add points on the road to
insert; click outside to extend a selected open endpoint or start a new road.
Move points, select straight or curved segments, edit and reset curve handles;
assign shared road colors and smoothly tapered widths to segments; configure road appearance, grid and snapping;
save editable SVGs with undo/redo and a clean preview.

| View | Source → ZIP entry | Screenshot | License | Original work |
| --- | --- | --- | --- | --- |
| Track editor (`view-track`) | `src/views/view-track.js` + `src/*.mjs` → `views/view-track.js` | Not available | [Apache-2.0](LICENSE) | [kkgams](https://github.com/kkgams) |

## Development

Requires Make, Python 3, Node.js 24+, Git, curl, zip, unzip and shasum. No package
installation or sibling checkout is needed. Host launch supports macOS Apple
Silicon and uses canonical local source with pinned released supporting Units.

| Command | Purpose |
| --- | --- |
| `make build` | Assemble `build.nosync/views/view-track.js`. |
| `make test` | Run native Node tests and check assembled JavaScript syntax. |
| `make package` | Build incremental `build.nosync/view.track.zip` and `SHA256SUMS`. |
| `make open` | Build and open local `gams.json` in pinned GAMS v3.2.0. |
| `make tools/gams.app` | Download the Host if absent, preserving accompanying notices. |
| `make serve-docs DOCS_PORT=8083` | Preview the pinned wiki independently. |
| `make docs` | Build `build.nosync/docs/`. |
| `make validate-docs` | Validate documentation. |
| `make clean` | Remove all of `build.nosync/`, `tools/` and `gams_modules/`, without ownership markers; refuse tracked files or symlinks in deletion paths before deleting anything. |

First launch needs network access. Existing Host downloads are never updated
implicitly and security checks remain intact. Keep authored content outside
`build.nosync/`, `tools/` and `gams_modules/`.
See [the wiki](docs/index.md) for editing controls, SVG format and installation.
