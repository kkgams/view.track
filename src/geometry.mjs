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

function trackCoordinates(point) {
    return `${Number(point.x.toFixed(3))} ${Number(point.y.toFixed(3))}`
}

function segmentCommand(segment) {
    return segment.shape === 'curve' ? `C ${trackCoordinates(segment.c)} ${trackCoordinates(segment.d)} ${trackCoordinates(segment.b)}` : `L ${trackCoordinates(segment.b)}`
}

export function segmentPath(segment) {
    return `M ${trackCoordinates(segment.a)} ${segmentCommand(segment)}`
}

export function trackPath(model) {
    if (!model.points.length) return ''
    return `M ${trackCoordinates(model.points[0])}` + trackSegments(model).map(segment => ` ${segmentCommand(segment)}`).join('') +
        (model.settings.closed && model.points.length > 2 ? ' Z' : '')
}

// Sample only for picking; saved geometry always comes from the control points.
export function nearestSegment(model, point, parameter = false, roadTolerance = null) {
    let best = null
    const profiles = roadTolerance === null ? null : trackRoadWidths(model)
    for (const segment of trackSegments(model)) {
        const samples = Array.from({ length: 65 }, (_, index) => segmentPoint(segment, index / 64))
        const lengths = [0]
        for (let index = 1; index < samples.length; index++) lengths.push(lengths[index - 1] + Math.hypot(samples[index].x - samples[index - 1].x, samples[index].y - samples[index - 1].y))
        for (let sample = 0; sample < 64; sample++) {
            const a = samples[sample], b = samples[sample + 1]
            const dx = b.x - a.x, dy = b.y - a.y
            const length = dx * dx + dy * dy
            const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
            const x = a.x + dx * t, y = a.y + dy * t
            const distance = Math.hypot(point.x - x, point.y - y)
            if (roadTolerance !== null) {
                const fraction = lengths[64] === 0 ? 0 : (lengths[sample] + t * (lengths[sample + 1] - lengths[sample])) / lengths[64]
                const radius = model.rendering.mode === 'centerline' ? 6 : roadWidthAt(profiles[segment.index], fraction) / 2 + model.rendering.edgeWidth + model.rendering.outlineWidth
                if (distance > radius + roadTolerance) continue
            }
            if (!best || distance < best.distance) {
                best = { index: segment.index, x, y, distance }
                if (parameter) best.t = (sample + t) / 64
            }
        }
    }
    return best
}

export function trackRoadWidths(model) {
    const styles = new Map(model.styles.map(style => [style.id, style]))
    const widths = model.segments.map(segment => {
        if (segment.styleId === null) return model.rendering.roadWidth
        const style = styles.get(segment.styleId)
        if (!style) throw new Error('Missing road style')
        return style.roadWidth
    })
    const closed = model.settings.closed && model.points.length > 2
    return widths.map((width, index) => ({ width,
        start: index === 0 && !closed ? width : (widths[(index + widths.length - 1) % widths.length] + width) / 2,
        end: index === widths.length - 1 && !closed ? width : (width + widths[(index + 1) % widths.length]) / 2,
    }))
}

// Width is measured along the centerline, not by the Bézier parameter. Both
// halves have zero slope at their ends, including the shared segment boundary.
export function roadWidthAt(profile, fraction) {
    const first = fraction <= 0.5
    const t = first ? fraction * 2 : (fraction - 0.5) * 2
    const blend = t * t * (3 - 2 * t)
    const a = first ? profile.start : profile.width
    const b = first ? profile.width : profile.end
    return a + (b - a) * blend
}

function roadPolyline(segment) {
    const points = [{ x: segment.a.x, y: segment.a.y }]
    const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)
    const middle = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    const flatten = (a, c, d, b, depth) => {
        const length = distance(a, c) + distance(c, d) + distance(d, b)
        if (depth === 10 || (length <= 12 && length - distance(a, b) <= 0.02)) {
            if (distance(points.at(-1), b) > 1e-9) points.push({ x: b.x, y: b.y })
            return
        }
        const ac = middle(a, c), cd = middle(c, d), db = middle(d, b)
        const left = middle(ac, cd), right = middle(cd, db), center = middle(left, right)
        flatten(a, ac, left, center, depth + 1)
        flatten(center, right, db, b, depth + 1)
    }
    flatten(segment.a, segment.c, segment.d, segment.b, 0)
    return points
}

export function trackRoadMesh(model, profiles = trackRoadWidths(model)) {
    return trackSegments(model).map(segment => {
        const points = roadPolyline(segment)
        const profile = profiles[segment.index]
        const lengths = [0]
        for (let index = 1; index < points.length; index++) lengths.push(lengths[index - 1] + Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y))
        const total = lengths.at(-1)
        // Include the arc-length midpoint so the style's target width is reached.
        const half = total / 2
        const split = lengths.findIndex(length => length > half)
        if (split > 0 && half > lengths[split - 1] + 1e-9 && half < lengths[split] - 1e-9) {
            const t = (half - lengths[split - 1]) / (lengths[split] - lengths[split - 1])
            const a = points[split - 1], b = points[split]
            points.splice(split, 0, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
            lengths.splice(split, 0, half)
        }
        const direction = (a, b) => {
            const length = Math.hypot(b.x - a.x, b.y - a.y)
            return { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
        }
        const samples = points.map((point, index) => {
            if (points.length === 1) return { ...point, width: Math.max(profile.start, profile.width, profile.end), normal: { x: 0, y: 1 }, round: true }
            const before = direction(points[Math.max(0, index - 1)], points[index === 0 ? 1 : index])
            const after = direction(points[index === points.length - 1 ? index - 1 : index], points[Math.min(points.length - 1, index + 1)])
            const dot = before.x * after.x + before.y * after.y
            const round = dot < 0.5
            const normal = round ? { x: -after.y, y: after.x } :
                { x: -(before.y + after.y) / (1 + dot), y: (before.x + after.x) / (1 + dot) }
            return { ...point, width: roadWidthAt(profile, lengths[index] / total), normal, round }
        })
        return { index: segment.index, samples }
    })
}

// Filled ribbons allow continuous width variation, unlike SVG stroke-width.
// Round joins/caps share the same boundary radius on both adjoining segments.
export function roadSurfacePath(mesh, padding = 0, caps = { start: true, end: true }) {
    const samples = mesh.samples
    const edge = (sample, side) => ({ x: sample.x + side * sample.normal.x * (sample.width / 2 + padding),
        y: sample.y + side * sample.normal.y * (sample.width / 2 + padding) })
    const circle = sample => {
        const radius = sample.width / 2 + padding
        const r = Number(radius.toFixed(3))
        return `M ${trackCoordinates({ x: sample.x + radius, y: sample.y })} A ${r} ${r} 0 1 0 ${trackCoordinates({ x: sample.x - radius, y: sample.y })} A ${r} ${r} 0 1 0 ${trackCoordinates({ x: sample.x + radius, y: sample.y })} Z`
    }
    if (samples.length === 1) return circle(samples[0])
    const sides = [...samples.map(sample => edge(sample, 1)), ...samples.toReversed().map(sample => edge(sample, -1))]
    const polygon = `M ${sides.map(trackCoordinates).join(' L ')} Z`
    const rounded = samples.filter((sample, index) => index === 0 ? caps.start : index === samples.length - 1 ? caps.end : sample.round)
    return [polygon, ...rounded.map(circle)].join(' ')
}
