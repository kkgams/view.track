export const BLUEPRINT_FORMAT = 'gams.track-blueprint'

export function createRendering(mode = 'road') {
    return { mode, roadWidth: 24, roadColor: '#454b55', edgeWidth: 2, edgeColor: '#eeeeee',
        outlineWidth: 2, outlineColor: '#15191f', centerlineVisible: true,
        centerlineColor: '#f5d76e', centerlineDash: '8 10' }
}

export function validateRendering(rendering) {
    const fail = message => { throw new Error(`Invalid blueprint: rendering ${message}`) }
    if (!rendering || !['road', 'centerline'].includes(rendering.mode)) fail('mode')
    for (const [key, minimum, maximum] of [['roadWidth', 1, 200], ['edgeWidth', 0, 50], ['outlineWidth', 0, 50]]) {
        if (!Number.isFinite(rendering[key]) || rendering[key] < minimum || rendering[key] > maximum) fail(`${key} (${minimum}–${maximum})`)
    }
    for (const key of ['roadColor', 'edgeColor', 'outlineColor', 'centerlineColor']) {
        if (typeof rendering[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(rendering[key])) fail(`${key} (use #RRGGBB)`)
    }
    if (typeof rendering.centerlineVisible !== 'boolean') fail('centerline visibility')
    const dash = rendering.centerlineDash
    if (typeof dash !== 'string' || dash.length > 128) fail('dash pattern')
    if (dash !== '') {
        if (!/^\d+(?:\.\d+)?(?:(?: +| *, *)\d+(?:\.\d+)?)*$/.test(dash)) fail('dash pattern (use positive lengths, or empty for solid)')
        const lengths = dash.split(/[ ,]+/).map(Number)
        if (lengths.length > 16 || lengths.some(length => length > 1000) || !lengths.some(length => length > 0)) fail('dash lengths (0–1000, not all zero)')
    }
}

export function createBlueprint() {
    return { format: BLUEPRINT_FORMAT, version: 1, name: 'Untitled track',
        viewport: { width: 1200, height: 800 },
        settings: { closed: true, smooth: true, snap: true, grid: true, gridSize: 40 },
        points: [], annotations: [], rendering: createRendering() }
}

export function validateBlueprint(value) {
    const fail = message => { throw new Error(`Invalid blueprint: ${message}`) }
    if (!value || value.format !== BLUEPRINT_FORMAT) fail('not an editor SVG')
    if (value.version !== 1) fail(`unsupported schema version ${value.version}`)
    if (typeof value.name !== 'string' || value.name.length > 1000) fail('name')
    if (!value.viewport || !['width', 'height'].every(key => Number.isFinite(value.viewport[key]) && value.viewport[key] >= 100 && value.viewport[key] <= 10000)) fail('viewport')
    if (!value.settings || !['closed', 'smooth', 'snap', 'grid'].every(key => typeof value.settings[key] === 'boolean')) fail('settings')
    if (!Number.isFinite(value.settings.gridSize) || value.settings.gridSize < 5 || value.settings.gridSize > 200) fail('grid size (5–200)')
    if (!Array.isArray(value.points) || value.points.length > 10000) fail('points (maximum 10000)')
    const ids = new Set()
    for (const point of value.points) {
        if (!point || typeof point.id !== 'string' || !point.id || ids.has(point.id)) fail('point IDs must be unique')
        ids.add(point.id)
        if (!['x', 'y'].every(key => Number.isFinite(point[key]) && Math.abs(point[key]) <= 100000)) fail('point coordinates')
    }
    if (!Array.isArray(value.annotations)) fail('annotations')
    const checked = structuredClone(value)
    // Version 1 SVGs saved before road styling had no rendering settings.
    if (!Object.hasOwn(checked, 'rendering')) checked.rendering = createRendering('centerline')
    validateRendering(checked.rendering)
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
        if (this.past.length > 100) { this.past.shift(); this.pastContexts.shift() }
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
    const snap = value => model.settings.snap ? Math.round(value / step) * step : value
    return { x: Math.max(0, Math.min(model.viewport.width, snap(x))), y: Math.max(0, Math.min(model.viewport.height, snap(y))) }
}
