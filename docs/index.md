---
title: Track blueprint editor
status: reference
---

# Track blueprint editor

A point-based SVG sketchbook for racing circuits, running inside [GAMS](https://github.com/kkgams/gams).
[Launch fresh Track demo](https://gams.z0.lv/app.html?showcase=https%3A%2F%2Fgithub.com%2Fkkgams%2Fshowcases%2Freleases%2Fdownload%2Fv0.3.0%2Ftrack.zip). Select and drag a control point on Sunset Circuit, then save the SVG.

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
| `make open` | Build and launch this checkout's `gams.json` in pinned GAMS v3.2.0 |
| `make serve-docs DOCS_PORT=8083` | Independent wiki preview |
| `make docs` | Build `build.nosync/docs/` |
| `make validate-docs` | Validate the wiki |
| `make clean` | Remove all of `build.nosync/`, `tools/` and `gams_modules/`, without ownership markers; refuse tracked files or symlinks in deletion paths before deleting anything. |

Existing Host downloads are not updated implicitly; security checks are not bypassed. Accompanying Host
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
standard tool_1 and tool_2 actions select Add point and Select.

## Sketch a circuit

Run `make open` on macOS Apple Silicon to open the local Project.

| Control | Action |
| --- | --- |
| Add point (D), Escape then click empty space | Start a new disconnected road |
| Add point (D), select an open endpoint then click outside the road | Extend that end; prepend at the start or append at the end |
| Add point (D), select an interior or loop point then click empty space | Start a new disconnected road |
| Add point (D), click on a road segment | Insert between its endpoints, including the closing segment |
| Add point (D), select one end then click the opposite end | Connect the first and last points into a loop |
| Add point (D), select an endpoint then click another road’s endpoint | Add a connecting segment and join the roads, keeping both points |
| Select (V), click a point | Select it without creating points |
| Select (V), click near a road segment | Select that segment and show its shape and curve handles |
| Select points, drag empty space | Box-select points in either direction; Shift adds to the selection |
| Shift-click a point | Add or remove it from the selection |
| Drag a selected point | Move the whole selection together; one undo step per drag |
| Delete selected points | Remove the selected points together |
| Hold Space + left-drag | Pan without switching tools |
| Zoom in / Fit track / Zoom out | Change the view scale or fit the full track and its road stroke |
| Split road at selected point | Remove one point and disconnect the road there; opens a loop or separates an open road |
| Drag an open endpoint onto another road’s open endpoint | Merge both roads, retaining just the destination point |
| Segment → Shape | Set the selected segment to Straight or Curved |
| Road styles table → Add road style / select row | Create or select a named road style |
| Style properties → Name / Road color / Road width | Edit the selected style, including tapered width |
| Segment → Road style | Choose a shared style, or Track default for the track-wide color |
| Segment → handle coordinates, or drag a curve handle | Adjust the selected curve without changing neighboring segments |
| Reset curve handles | Restore the selected segment’s automatic curve |
| Show grid / Snap to grid / Grid size | Configure the grid independently of curve generation |
| Undo / Redo | Restore edits, settings and opened documents; keeps the latest 100 edits |
| Preview | Hide the grid and points, and disable shape editing |
| Save / Save as | Write an editable SVG through GAMS filesystem APIs |
| Open SVG | Reopen an SVG saved by this editor using the GAMS file chooser |
| Download SVG | Browser download of the same editable SVG, without changing the current save path |

The header uses Host Material Symbol buttons, grouped as file actions, point
tools, edit history and view controls. The active tool is highlighted and has
`aria-pressed="true"`; hover tips identify each icon.

A blueprint can contain multiple disconnected roads. With no points selected,
clicking empty space starts a new open road. Press **Escape** to deselect before
starting another road. The new point becomes selected, so subsequent clicks
continue that road. Select an endpoint of an existing open road to extend it:
the new point is added before the start or after the end, without inserting
between existing neighbors. Selecting an interior point or any point in a loop
and clicking empty space starts a new road instead. The new point remains
selected so subsequent clicks continue from its endpoint.
Select exactly one endpoint to continue drawing; off-road clicks with multiple
points selected do not add points. Clicking an existing road still splits the
clicked segment even when nothing is selected. Roads remain independent at
crossings; in Select mode, clicking another road’s endpoint only selects it.
New off-road connections use automatic curves and the default road style;
unaffected segment records are preserved.

To close a road into a loop, click its first point while its last point is selected
in Add point mode (or the reverse). This requires at least three points.

Select one point and press **Split road at selected point** to remove that point
and its incident segments without reconnecting its neighbors. In the middle of
an open road this creates two separate roads; on a loop it opens the remaining
route at the gap. Splitting at an open endpoint trims that end. Removing a lone
point removes its road. **Delete selected points**, unlike Split, reconnects
surviving neighbors within each road.

To connect two roads, select an endpoint in **Add point (D)** mode and click the
other road’s endpoint. This adds an automatic curved segment using Track default,
keeping both existing points and their positions—just like adding the closing
segment of a loop. Shift-click only changes selection and never joins roads.

Dragging an endpoint onto another road’s endpoint is different: it welds the two
points into one. A highlighted ring marks the merge target. The destination
point’s ID and exact position are retained; the dragged point is removed.
Both joining actions orient the roads into one route, retaining the destination
road’s ID and metadata and removing the source road record. Interior points,
loop points and multi-point group drags do not join roads. A lone point is also
an open endpoint. Esc cancels a drag without joining. Splitting, click-connecting
and drag-merging are each one undo step.
To remove every road, select all and delete.

With the SVG focused, D/V switches tools, Ctrl/Cmd+A selects all points,
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
Snapping rounds new and inserted points, curve handles, and selection movement;
toggling it does not move existing geometry. Coincident points are permitted.
With fewer than three points in a road, a closed road is displayed as an open segment.

## Edit a segment

Use **Select (V)** and click on the visible road (with a six-screen-pixel picking margin), or choose it
from **Selected segment** in the inspector. Point handles take precedence when
clicking near an endpoint; the inspector can select any segment, including
coincident or overlapping segments. A selected segment is highlighted.

Choose **Straight** for an exact line between its endpoints, or **Curved** for
a cubic Bézier. New segments start curved, with automatic handles calculated
from neighboring points using uniform Catmull–Rom. The shape belongs to each
segment, not to either endpoint; there is no global curve toggle.

### Shared road styles

The **Road styles** table is at the top of the sidebar. Press **Add road style**
or select an existing row, then edit its name, six-digit hex color (such as
`#a05a32`) and road width in **Style properties** below the table. The table
shows names, usage counts and delete buttons, not editable color cells. Up/Down, Home/End and
Enter/Space select styles from the keyboard; selection does not dirty the document
or enter undo history. The properties block is disabled when no styles exist.
Choose that style in **Segment → Road style**. Editing a style updates every segment using it;
renaming it keeps its assignments intact because references use stable IDs.

**Track default** uses **Road appearance → Road color / Road width**. New style
definitions copy the current track-wide color and width, then keep their own
values. New connections use Track default; styles are assigned explicitly. The **Used** column counts assigned
segments. Delete is disabled while a style is in use: change its segments to
Track default or another style first. Deleting all points preserves the style
definitions. Style creation, edits, assignment and deletion are undoable.

Style colors and widths appear in **Styled road** mode in the editor, preview and saved SVG.
**Centerline only** retains style assignments without displaying asphalt. Styles
and assignments may be edited in preview for an already selected segment.
Shoulder, outline and center-marking colors remain track-wide. Styles currently
contain a name, road color and road width; they do not assign physical behavior,
bridge, tunnel or elevation properties. Names must be unique ignoring case, contain
1–100 characters with no surrounding spaces; a blueprint supports up to 256 styles.

### Smooth width changes

Set **Style properties → Road width** to 1–200 blueprint units; fractional widths
are allowed. All segments using the style share that target width. The target is
reached at each segment’s distance-along-road midpoint. At a connection, both
segments use the average of their target widths. Width varies smoothly between
these values, with zero width-change slope at midpoints and connections. Open
ends keep their own segment’s target width; closed loops also taper across the
last/first connection.

Consecutive segments with the same target width remain that width at their
shared connection. Shoulders and outlines keep their configured thickness per
side while following the taper; center markings remain on the exact centerline.
The same generated road surface is used in the editor, preview and saved SVG.
**Fit track** includes the widest assigned road style. Changes to route topology
recalculate the taper; inserting a point retains the style on both split segments.

### Curve handles

A selected curved segment shows two draggable handles. The inspector also
provides their absolute X/Y coordinates for keyboard editing. Handle edits affect
only the selected segment; they do not force neighboring curves to align.
Movement follows grid snapping and stays within the document. A complete handle
drag is one undo step; Escape cancels it. Changing inspector coordinates is
also undoable.

Editing either handle makes both handles explicit. Their saved values are offsets
from their corresponding endpoints, so moving a point carries its attached
manual handle with it. Switching to Straight hides but retains those offsets;
switching back restores them. **Reset curve handles** removes both manual offsets
and recalculates the curve from the current neighboring points.

Insertion splits the selected connection into two segments of the same shape
and style assignment.
Curves are split with explicit handles to preserve their shape; with snapping on,
the inserted endpoint and its attached handles move to the grid. Deletion rebuilds
affected connections as automatic curves. Unaffected segments retain their IDs,
shapes, style assignments and manual handles. Split removes only the selected
point and its incident segments, leaving no replacement connection across the
gap. Merging retains segment IDs, shapes and styles; reversing a route swaps its
manual start/end handles. Automatic handles and width taper adapt to the new
neighbors. Closing a road creates a new automatic closing segment. These topology
edits are undoable. Preview and
saved SVGs never include segment highlights or handles.

SVG files have a white background and the selected road appearance, without
editing overlays. Use them directly in browsers, webpages and wikis. Ordinary SVG drawings without
this editor's metadata cannot be imported. Imported drawing markup is never
mounted or executed.

## Road appearance

Choose **Styled road** or **Centerline only** under Road appearance. The choice
applies to the editor, clean preview and saved SVG. Blueprints use a styled road by default.
Appearance edits are undoable and never move control points. You can adjust
appearance while clean preview is enabled.

| Setting | Meaning |
| --- | --- |
| Road width / color | Default asphalt width (1–200 units) and `#RRGGBB` color |
| Shoulder width / color | Added width on each side (0–50 units) and color |
| Outline thickness / color | Added thickness outside each shoulder (0–50 units) and color |
| Centerline marking / color | Show or hide the 1.5-unit center marking and choose its color |
| Dash lengths | Space- or comma-separated lengths, such as `8 10`; empty means solid |

The road retains one exact centerline path in SVG `<defs>`. With uniform width,
ordered `<use>` references paint outline, shoulders, asphalt and center marking.
Their widths are `road + 2×shoulder + 2×outline`, `road + 2×shoulder`, and `road`.
When assigned widths differ, sampled filled SVG ribbons paint those three road
surfaces; their boundaries follow the smooth width profile. Sampling is for the
road surface only, not the saved control points or centerline. Style-colored
asphalt paints above the base asphalt and below the continuous center marking.
Internal color boundaries remain flat and open ends retain rounded caps.
Centerline-only mode uses a simple 12-unit stroke and retains style settings.

Dash patterns accept up to 16 lengths from 0 to 1000, with at least one positive
length. Colors accept six-digit hex values only. Road surfaces are generated SVG
geometry, not separately editable road edges or 3D meshes. Whole-path layering does
not establish over/under ordering at crossings.

## Editable SVG format

The SVG contains one direct child `<metadata id="gams-track-blueprint">` whose
text is JSON. The visible path is generated from that JSON, never parsed back
into points. The format is `gams.track-blueprint`, schema version `2`. Version-1 files are
validated and upgraded to a single road on import; subsequent saves use version 2.
Older editors that support only version 1 cannot reopen the new files.

| Field | Meaning |
| --- | --- |
| `format`, `version` | Format identity and schema version; unsupported versions are rejected |
| `name` | Track name or identifier |
| `viewport` | Width and height in blueprint units |
| `settings` | `snap`, `grid`, `gridSize` |
| `roads` | `{id, closed, pointIds}` records; `pointIds` defines each road’s route order |
| `points` | `{id, x, y}` records shared by ID lookup; each point belongs to exactly one road |
| `segments` | Ordered `{id, from, to, shape, handles, styleId}` records matching route connections |
| `styles` | Shared `{id, name, roadColor, roadWidth}` definitions with unique IDs and names |
| `annotations` | Reserved array for later design stages; empty in newly created V1 blueprints |
| `rendering` | `mode`, `roadWidth`, `roadColor`, `edgeWidth`, `edgeColor`, `outlineWidth`, `outlineColor`, `centerlineVisible`, `centerlineColor`, `centerlineDash` |

All listed fields are required. Road IDs are unique and each road has a nonempty
ordered list of unique point IDs; missing, repeated or shared point references
are rejected. An empty blueprint has no roads. Segment IDs are unique; `from`
and `to` reference adjacent points within a road, including its closing connection
when closed with at least three points. Segment records follow road order and
then connection order; there are no connections between roads. `shape` is `straight` or `curve`. `handles`
is `null` for automatic curves or `{start: {x, y}, end: {x, y}}` for manual
endpoint-relative offsets. Manual handles remain stored while a segment is straight. `styleId` is `null`
for Track default, or the ID of a style in `styles`. Missing or dangling references
are invalid. Each style’s `roadColor` is a six-digit `#RRGGBB` value and
`roadWidth` is a finite number from 1 to 200.
Malformed metadata is rejected before replacing the document.

Unknown JSON fields on the document, roads, points, segments, styles and annotations survive save/load
and undo/redo. Annotations are not interpreted or remapped when route topology changes.
Elevation, bridges, tunnels and 3D handoff are not implemented.
Files are limited to 8 MiB of SVG text and 10,000 points. Invalid data is rejected
before replacing the current document; a failed save does not mark it as saved.
