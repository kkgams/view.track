---
title: Track blueprint editor
status: reference
---

# Track blueprint editor

A point-based SVG sketchbook for racing circuits, running inside [GAMS](https://github.com/kkgams/gams).

| Component | Source → ZIP entry | Screenshot | Original work |
| --- | --- | --- | --- |
| `view-track` | `src/views/view-track.js` + `src/{model,geometry,svg,interaction}.mjs` → `views/view-track.js` | Not available | kkgams |

## Development

Requires Make, Python 3, Node.js 24+, Git, curl, zip, unzip and shasum. No npm
packages or sibling checkouts are needed.

| Command | Result |
| --- | --- |
| `make build` | Assemble `build.nosync/views/view-track.js` |
| `make test` | Native Node tests and assembled JavaScript syntax check |
| `make package` | Incremental `build.nosync/view.track.zip` and `SHA256SUMS` |
| `make open` | Build and launch this checkout's `gams.json` in pinned GAMS v3.1.1 |
| `make serve-docs DOCS_PORT=8083` | Independent wiki preview |
| `make docs` | Build `build.nosync/docs/` |
| `make validate-docs` | Validate the wiki |
| `make clean` | Remove `build.nosync/` and identified managed Host/notices; refuse supplied unmarked tools |

Clean refuses unmarked supplied Host tools, tracked files and symlinks in deletion paths. Installed Units in
`gams_modules/` and unrelated tools are preserved. Existing Host downloads are
not updated implicitly; security checks are not bypassed. Accompanying Host
notices remain under `tools/gams-release-notices/`.

The ZIP contains the assembled View, README and Apache-2.0 license. Register
`views/view-track.js` as `view-track` in `ui.views`. Pin a published release URL
with `#views/view-track.js`; no release is required for local development.
The Host loads Views through blob URLs, so assembly removes helper-relative
imports while retaining absolute Host imports.

The local `gams.json` pins filesystem/layout plugins v0.2.0, six UI Services
v0.2.0, `view.files` v1.0.0 and `theme.gams` v1.0.2. File chooser Views select
their entries from the existing `view.files-1.0.0.zip` release. The editor uses
`fs/fs::read-text`, `fs/fs::write-text` and `ui.popup.open`, and registers through
the Host's `/util/view-plugin.js`. Optional `data-source` selects an initial SVG.
Host-dispatched open, save, saveAs, undo, redo, deleteSelected, clearSelection,
zoomIn, zoomOut and zoomFit actions share the toolbar's operation guard. The
standard tool_1 through tool_4 actions select Draw, Select, Insert and Pan.

## Sketch a circuit

Run `make open` on macOS Apple Silicon to open the local Project.

| Control | Action |
| --- | --- |
| Draw points (D), click empty canvas | Append a point |
| Select points (V), click a point | Select it without creating points |
| Select points, drag empty space | Box-select points in either direction; Shift adds to the selection |
| Shift-click a point | Add or remove it from the selection |
| Drag a selected point | Move the whole selection together; one undo step per drag |
| Delete selected points | Remove the selected points together |
| Insert point (I), click near a segment | Insert between its endpoints, including the closing segment |
| Pan (H), drag | Move the view without editing points |
| Zoom in / Fit track / Zoom out | Change the view scale or fit the full track and its road stroke |
| Closed loop / Smooth curves | Choose a closed circuit or open route; curves or straight lines |
| Show grid / Snap to grid / Grid size | Configure the grid independently of curve generation |
| Undo / Redo | Restore edits, settings and opened documents; keeps the latest 100 edits |
| Clear | Remove points and annotations; undo restores them |
| Preview | Hide the grid and points, and disable shape editing |
| Save / Save as | Write an editable SVG through GAMS filesystem APIs |
| Open SVG | Reopen an SVG saved by this editor using the GAMS file chooser |
| Download SVG | Browser download of the same editable SVG, without changing the current save path |

The header uses Host Material Symbol buttons, grouped as file actions, point
tools, edit history and view controls. The active tool is highlighted and has
`aria-pressed="true"`; hover tips identify each icon.

With the SVG focused, D/V/I/H switches tools, Ctrl/Cmd+A selects all points,
Delete/Backspace deletes the selection, Ctrl/Cmd+Z undoes,
Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes, and Ctrl/Cmd+S saves. Escape cancels an
active drag or clears the selection. Settings and the track name are undoable.
Opening another document is also undoable and restores the corresponding save
destination when undone.

Hold Space and drag to pan temporarily without switching tools; middle-button
drag also pans. The wheel/trackpad pans normally, while Ctrl/Cmd+wheel zooms
around the pointer, matching the canvas Views. Zoom ranges from 2% to 6400% of
the initial document view. Opening an SVG fits its track automatically. Selection,
tool choice, pan and zoom are session-only: they do not dirty the document,
enter undo history, or change the exported SVG. Preview mode still allows
navigation but not point editing.

Group movement applies one shared translation so point spacing is preserved.
Snapping rounds that translation to grid increments, rather than snapping each
point separately. Movement is clamped as a group to the document edges when the
selection fits inside the document; oversized imported selections retain their
relative geometry. Point handles keep a constant on-screen size while zooming.

The drawing area defaults to 1200 × 800 units. Grid sizes range from 5 to 200.
Snapping rounds new and inserted points, and quantizes selection movement;
toggling it does not move existing points. Smooth curves use uniform Catmull–Rom converted to cubic Béziers, with
no manual handles or road geometry. Coincident points are permitted. With fewer
than three points, a closed route is displayed as an open segment.

SVG files have a white background and the selected road appearance, without
editing overlays. Use them directly in browsers, webpages and wikis. Ordinary SVG drawings without
this editor's metadata cannot be imported. Imported drawing markup is never
mounted or executed.

## Road appearance

Choose **Styled road** or **Centerline only** under Road appearance. The choice
applies to the editor, clean preview and saved SVG. New blueprints use a styled
road; older SVGs without rendering settings reopen as their original simple line.
Appearance edits are undoable and never move control points. You can adjust
appearance while clean preview is enabled.

| Setting | Meaning |
| --- | --- |
| Road width / color | Asphalt stroke width (1–200 units) and `#RRGGBB` color |
| Shoulder width / color | Added width on each side (0–50 units) and color |
| Outline thickness / color | Added thickness outside each shoulder (0–50 units) and color |
| Centerline marking / color | Show or hide the 1.5-unit center marking and choose its color |
| Dash lengths | Space- or comma-separated lengths, such as `8 10`; empty means solid |

The road uses one centerline path in SVG `<defs>`. Ordered `<use>` references
paint the outline, shoulders, asphalt and optional center marking. Their widths
are `road + 2×shoulder + 2×outline`, `road + 2×shoulder`, and `road` respectively.
All layers update from the same geometry. Centerline-only mode uses a simple
12-unit stroke instead, retaining the road settings when switching back.

Dash patterns accept up to 16 lengths from 0 to 1000, with at least one positive
length. Colors accept six-digit hex values only. These are SVG strokes, not
separate editable curves, offset road edges or meshes. Whole-path layering does
not establish over/under ordering at crossings.

## Editable SVG format

The SVG contains one direct child `<metadata id="gams-track-blueprint">` whose
text is JSON. The visible path is generated from that JSON, never parsed back
into points. The format is `gams.track-blueprint`, schema version `1`.

| Field | Meaning |
| --- | --- |
| `format`, `version` | Format identity and schema version; unsupported versions are rejected |
| `name` | Track name or identifier |
| `viewport` | Width and height in blueprint units |
| `settings` | `closed`, `smooth`, `snap`, `grid`, `gridSize` |
| `points` | Ordered `{id, x, y}` records; IDs remain stable when points move |
| `annotations` | Reserved array for later design stages; empty in newly created V1 blueprints |
| `rendering` | `mode`, `roadWidth`, `roadColor`, `edgeWidth`, `edgeColor`, `outlineWidth`, `outlineColor`, `centerlineVisible`, `centerlineColor`, `centerlineDash` |

`rendering` is an optional, additive version-1 field. When absent, the importer
supplies centerline-only defaults; a present but malformed object is rejected.

Unknown JSON fields on the document, points and annotations survive save/load
and undo/redo. Later versions can associate conceptual elevation with point IDs
and structural markers with route positions instead of screen coordinates.
V1 does not edit, validate or remap those future annotations when points are
inserted or deleted. Elevation, structures and 3D handoff are not implemented.
Files are limited to 8 MiB of SVG text and 10,000 points. Invalid data is rejected
before replacing the current document; a failed save does not mark it as saved.
