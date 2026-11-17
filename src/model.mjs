export const BLUEPRINT_FORMAT = "gams.track-blueprint"

export function createRendering(mode = "road") {
    return {
        mode,
        roadWidth: 24,
        roadColor: "#454b55",
        edgeWidth: 2,
        edgeColor: "#eeeeee",
        outlineWidth: 2,
        outlineColor: "#15191f",
        centerlineVisible: true,
        centerlineColor: "#f5d76e",
        centerlineDash: "8 10",
    }
}

export function validateRendering(rendering) {
    const fail = (message) => {
        throw new Error(`Invalid blueprint: rendering ${message}`)
    }
    if (!rendering || !["road", "centerline"].includes(rendering.mode)) fail("mode")
    for (const [key, minimum, maximum] of [
        ["roadWidth", 1, 200],
        ["edgeWidth", 0, 50],
        ["outlineWidth", 0, 50],
    ]) {
        if (!Number.isFinite(rendering[key]) || rendering[key] < minimum || rendering[key] > maximum)
            fail(`${key} (${minimum}–${maximum})`)
    }
    for (const key of ["roadColor", "edgeColor", "outlineColor", "centerlineColor"]) {
        if (typeof rendering[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(rendering[key])) fail(`${key} (use #RRGGBB)`)
    }
    if (typeof rendering.centerlineVisible !== "boolean") fail("centerline visibility")
    const dash = rendering.centerlineDash
    if (typeof dash !== "string" || dash.length > 128) fail("dash pattern")
    if (dash !== "") {
        if (!/^\d+(?:\.\d+)?(?:(?: +| *, *)\d+(?:\.\d+)?)*$/.test(dash))
            fail("dash pattern (use positive lengths, or empty for solid)")
        const lengths = dash.split(/[ ,]+/).map(Number)
        if (lengths.length > 16 || lengths.some((length) => length > 1000) || !lengths.some((length) => length > 0))
            fail("dash lengths (0–1000, not all zero)")
    }
}

export function createBlueprint() {
    return {
        format: BLUEPRINT_FORMAT,
        version: 2,
        name: "Untitled track",
        viewport: { width: 1200, height: 800 },
        settings: { snap: true, grid: true, gridSize: 40 },
        roads: [],
        points: [],
        segments: [],
        styles: [],
        annotations: [],
        rendering: createRendering(),
    }
}

export function validateBlueprint(value) {
    const fail = (message) => {
        throw new Error(`Invalid blueprint: ${message}`)
    }
    if (!value || value.format !== BLUEPRINT_FORMAT) fail("not an editor SVG")
    if (![1, 2].includes(value.version)) fail(`unsupported schema version ${value.version}`)
    if (value.version === 1 && Object.hasOwn(value, "roads")) fail("legacy schema must not contain roads")
    if (typeof value.name !== "string" || value.name.length > 1000) fail("name")
    if (
        !value.viewport ||
        !["width", "height"].every(
            (key) => Number.isFinite(value.viewport[key]) && value.viewport[key] >= 100 && value.viewport[key] <= 10000,
        )
    )
        fail("viewport")
    if (
        !value.settings ||
        !(value.version === 1 ? ["closed", "snap", "grid"] : ["snap", "grid"]).every(
            (key) => typeof value.settings[key] === "boolean",
        )
    )
        fail("settings")
    if (value.version === 2 && Object.hasOwn(value.settings, "closed"))
        fail("closed belongs to each road, not settings")
    if (!Number.isFinite(value.settings.gridSize) || value.settings.gridSize < 5 || value.settings.gridSize > 200)
        fail("grid size (5–200)")
    if (!Array.isArray(value.points) || value.points.length > 10000) fail("points (maximum 10000)")
    const ids = new Set()
    for (const point of value.points) {
        if (!point || typeof point.id !== "string" || !point.id || ids.has(point.id)) fail("point IDs must be unique")
        ids.add(point.id)
        if (!["x", "y"].every((key) => Number.isFinite(point[key]) && Math.abs(point[key]) <= 100000))
            fail("point coordinates")
    }
    if (!Array.isArray(value.annotations)) fail("annotations")
    if (!Array.isArray(value.styles) || value.styles.length > 256) fail("styles (maximum 256)")
    const styleIds = new Set(),
        styleNames = new Set()
    for (const style of value.styles) {
        if (!style || typeof style.id !== "string" || !style.id || styleIds.has(style.id))
            fail("style IDs must be unique")
        styleIds.add(style.id)
        if (
            typeof style.name !== "string" ||
            !style.name.trim() ||
            style.name !== style.name.trim() ||
            style.name.length > 100
        )
            fail("style name (1–100 characters, no surrounding spaces)")
        const name = style.name.toLowerCase()
        if (styleNames.has(name)) fail("style names must be unique")
        styleNames.add(name)
        if (!Number.isFinite(style.roadWidth) || style.roadWidth < 1 || style.roadWidth > 200)
            fail("style road width (1–200)")
        if (typeof style.roadColor !== "string" || !/^#[0-9a-f]{6}$/i.test(style.roadColor))
            fail("style road color (use #RRGGBB)")
    }
    if (!Array.isArray(value.segments)) fail("segments")
    const pairs = value.version === 1 ? roadPointPairs(value.points, value.settings.closed) : trackPointPairs(value)
    if (value.segments.length !== pairs.length) fail("segment count must match the route")
    const segmentIds = new Set()
    value.segments.forEach((segment, index) => {
        if (!segment || typeof segment.id !== "string" || !segment.id || segmentIds.has(segment.id))
            fail("segment IDs must be unique")
        segmentIds.add(segment.id)
        const [from, to] = pairs[index]
        if (segment.from !== from.id || segment.to !== to.id) fail("segment endpoints must match route order")
        if (!["straight", "curve"].includes(segment.shape)) fail("segment shape")
        if (segment.styleId !== null && !styleIds.has(segment.styleId))
            fail("segment style must reference a defined style or be null")
        if (segment.handles !== null) {
            if (
                !segment.handles ||
                !["start", "end"].every((key) => {
                    const handle = segment.handles[key]
                    return (
                        handle &&
                        ["x", "y"].every((axis) => Number.isFinite(handle[axis]) && Math.abs(handle[axis]) <= 200000)
                    )
                })
            )
                fail("segment handles")
        }
    })
    validateRendering(value.rendering)
    const checked = structuredClone(value)
    if (checked.version === 1) {
        const closed = checked.settings.closed
        delete checked.settings.closed
        checked.version = 2
        checked.roads = checked.points.length
            ? [{ id: "road-1", closed, pointIds: checked.points.map((point) => point.id) }]
            : []
    }
    return checked
}

export class TrackHistory {
    constructor(model = createBlueprint(), context = null) {
        this.model = validateBlueprint(model)
        this.context = context
        this.past = []
        this.future = []
        this.pastContexts = []
        this.futureContexts = []
    }
    commit(next, context = this.context) {
        const checked = validateBlueprint(next)
        if (context === this.context && JSON.stringify(checked) === JSON.stringify(this.model)) return false
        this.past.push(this.model)
        this.pastContexts.push(this.context)
        if (this.past.length > 100) {
            this.past.shift()
            this.pastContexts.shift()
        }
        this.model = checked
        this.context = context
        this.future = []
        this.futureContexts = []
        return true
    }
    undo() {
        if (!this.past.length) return false
        this.future.push(this.model)
        this.futureContexts.push(this.context)
        this.model = this.past.pop()
        this.context = this.pastContexts.pop()
        return true
    }
    redo() {
        if (!this.future.length) return false
        this.past.push(this.model)
        this.pastContexts.push(this.context)
        this.model = this.future.pop()
        this.context = this.futureContexts.pop()
        return true
    }
}

export function placePoint(model, x, y) {
    const step = model.settings.gridSize
    const snap = (value) => (model.settings.snap ? Math.round(value / step) * step : value)
    return {
        x: Math.max(0, Math.min(model.viewport.width, snap(x))),
        y: Math.max(0, Math.min(model.viewport.height, snap(y))),
    }
}

function roadPointPairs(points, closed) {
    const count = points.length
    if (count < 2) return []
    return Array.from({ length: closed && count > 2 ? count : count - 1 }, (_, index) => [
        points[index],
        points[(index + 1) % count],
    ])
}

// Ownership is explicit, including while editing before segments are synchronized.
function resolveTrackRoads(model) {
    const fail = (message) => {
        throw new Error(`Invalid blueprint: ${message}`)
    }
    if (!Array.isArray(model.roads) || model.roads.length > 10000) fail("roads (maximum 10000)")
    const points = new Map()
    for (const point of model.points) {
        if (!point || typeof point.id !== "string" || !point.id || points.has(point.id))
            fail("point IDs must be unique")
        points.set(point.id, point)
    }
    const ids = new Set(),
        owned = new Set()
    const roads = model.roads.map((road) => {
        if (!road || typeof road.id !== "string" || !road.id || ids.has(road.id))
            fail("road IDs must be unique and nonempty")
        ids.add(road.id)
        if (typeof road.closed !== "boolean") fail("road closed must be boolean")
        if (!Array.isArray(road.pointIds) || !road.pointIds.length || road.pointIds.length > 10000)
            fail("road pointIds must be nonempty (maximum 10000)")
        const resolved = road.pointIds.map((id) => {
            if (!points.has(id)) fail("road references a missing point")
            if (owned.has(id)) fail("point membership must be unique")
            owned.add(id)
            return points.get(id)
        })
        return { ...road, points: resolved }
    })
    if (owned.size !== points.size) fail("every point must belong to exactly one road")
    return roads
}

// Road order owns connectivity; segments own shape and endpoint-relative handles.
export function trackPointPairs(model) {
    return resolveTrackRoads(model).flatMap((road) => roadPointPairs(road.points, road.closed))
}

export function trackRoads(model) {
    let offset = 0
    const roads = resolveTrackRoads(model).map((road) => {
        const pairs = roadPointPairs(road.points, road.closed)
        const segments = pairs.map(([from, to]) => {
            const segment = model.segments[offset++]
            if (!segment || segment.from !== from.id || segment.to !== to.id)
                throw new Error("Invalid blueprint: segment endpoints must match route order")
            return segment
        })
        return { ...road, segments }
    })
    if (offset !== model.segments.length) throw new Error("Invalid blueprint: segment count must match the route")
    return roads
}

export function syncTrackSegments(model) {
    const existing = new Map(model.segments.map((segment) => [JSON.stringify([segment.from, segment.to]), segment]))
    model.segments = trackPointPairs(model).map(
        ([from, to]) =>
            existing.get(JSON.stringify([from.id, to.id])) || {
                id: crypto.randomUUID(),
                from: from.id,
                to: to.id,
                shape: "curve",
                handles: null,
                styleId: null,
            },
    )
    return model
}
