export function trackSegments(model) {
    const points = model.points
    if (points.length < 2) return []
    const closed = model.settings.closed && points.length > 2
    const at = index => points[closed ? (index + points.length) % points.length : Math.max(0, Math.min(points.length - 1, index))]
    return model.segments.map((segment, index) => {
        const [p0, a, b, p3] = [at(index - 1), at(index), at(index + 1), at(index + 2)]
        const curve = segment.shape === 'curve'
        const c = !curve ? a : segment.handles === null ?
            { x: a.x + (b.x - p0.x) / 6, y: a.y + (b.y - p0.y) / 6 } :
            { x: a.x + segment.handles.start.x, y: a.y + segment.handles.start.y }
        const d = !curve ? b : segment.handles === null ?
            { x: b.x - (p3.x - a.x) / 6, y: b.y - (p3.y - a.y) / 6 } :
            { x: b.x + segment.handles.end.x, y: b.y + segment.handles.end.y }
        return { index, id: segment.id, shape: segment.shape, a, b, c, d }
    })
}

export function segmentPoint(segment, t) {
    const u = 1 - t
    return { x: u ** 3 * segment.a.x + 3 * u * u * t * segment.c.x + 3 * u * t * t * segment.d.x + t ** 3 * segment.b.x,
        y: u ** 3 * segment.a.y + 3 * u * u * t * segment.c.y + 3 * u * t * t * segment.d.y + t ** 3 * segment.b.y }
}

export function trackPath(model) {
    if (!model.points.length) return ''
    const number = n => Number(n.toFixed(3))
    const xy = p => `${number(p.x)} ${number(p.y)}`
    const segments = trackSegments(model)
    return `M ${xy(model.points[0])}` + segments.map(s => s.shape === 'curve' ? ` C ${xy(s.c)} ${xy(s.d)} ${xy(s.b)}` : ` L ${xy(s.b)}`).join('') + (model.settings.closed && model.points.length > 2 ? ' Z' : '')
}

// Sample only for picking; saved geometry always comes from the control points.
export function nearestSegment(model, point, parameter = false) {
    let best = null
    for (const segment of trackSegments(model)) {
        for (let sample = 0; sample < 64; sample++) {
            const a = segmentPoint(segment, sample / 64)
            const b = segmentPoint(segment, (sample + 1) / 64)
            const dx = b.x - a.x, dy = b.y - a.y
            const length = dx * dx + dy * dy
            const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
            const x = a.x + dx * t, y = a.y + dy * t
            const distance = Math.hypot(point.x - x, point.y - y)
            if (!best || distance < best.distance) {
                best = { index: segment.index, x, y, distance }
                if (parameter) best.t = (sample + t) / 64
            }
        }
    }
    return best
}
