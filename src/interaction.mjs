import { placePoint, syncTrackSegments, validateBlueprint } from './model.mjs'
import { trackSegments } from './geometry.mjs'

// Selection and camera state are session-only; neither changes the SVG document schema.
export function pointsInBox(points, start, end, base = []) {
    const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x)
    const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y)
    return new Set([...base, ...points.filter(point => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY).map(point => point.id)])
}

export function moveTrackSelection(model, ids, delta) {
    const next = structuredClone(model)
    const selected = model.points.filter(point => ids.has(point.id))
    if (!selected.length) return next
    const step = model.settings.gridSize
    const snap = value => model.settings.snap ? Math.round(value / step) * step : value
    // Clamp one common translation, never individual points: relative distances stay intact.
    const clamp = (value, low, high) => low <= high ? Math.max(low, Math.min(high, value)) : value
    const xs = selected.map(point => point.x), ys = selected.map(point => point.y)
    const dx = clamp(snap(delta.x), -Math.min(...xs), model.viewport.width - Math.max(...xs))
    const dy = clamp(snap(delta.y), -Math.min(...ys), model.viewport.height - Math.max(...ys))
    for (const point of next.points) if (ids.has(point.id)) { point.x += dx; point.y += dy }
    return next
}

export function trackWheelZoomFactor(deltaY, deltaMode, pageHeight) {
    const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1
    return Math.exp(-deltaY * unit * 0.002)
}

export function zoomTrackCamera(camera, viewport, anchor, factor) {
    const scale = viewport.width / camera.width
    const target = Math.max(0.02, Math.min(64, scale * factor))
    const change = target / scale
    return { x: anchor.x - (anchor.x - camera.x) / change, y: anchor.y - (anchor.y - camera.y) / change,
        width: camera.width / change, height: camera.height / change }
}

export function fitTrackCamera(points, viewport, padding = 40) {
    if (!points.length) return { x: 0, y: 0, width: viewport.width, height: viewport.height }
    const xs = points.map(point => point.x), ys = points.map(point => point.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const width = Math.max(viewport.width / 64, maxX - minX + padding * 2, (maxY - minY + padding * 2) * viewport.width / viewport.height)
    const height = width * viewport.height / viewport.width
    const camera = { x: (minX + maxX - width) / 2, y: (minY + maxY - height) / 2, width, height }
    return zoomTrackCamera(camera, viewport, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, 1)
}

export function editTrackSegment(model, id, shape) {
    if (!['straight', 'curve'].includes(shape)) throw new Error('Invalid segment shape')
    const next = structuredClone(model)
    const segment = next.segments.find(segment => segment.id === id)
    if (!segment) throw new Error('Missing segment')
    segment.shape = shape
    return next
}

export function resetTrackHandles(model, id) {
    const next = structuredClone(model)
    const segment = next.segments.find(segment => segment.id === id)
    if (!segment) throw new Error('Missing segment')
    segment.handles = null
    return next
}

export function moveTrackHandle(model, id, handle, position) {
    if (!['start', 'end'].includes(handle)) throw new Error('Invalid curve handle')
    const geometry = trackSegments(model).find(segment => segment.id === id)
    if (!geometry || geometry.shape !== 'curve') throw new Error('Missing curved segment')
    const next = structuredClone(model)
    const segment = next.segments[geometry.index]
    if (segment.handles === null) segment.handles = {
        start: { x: geometry.c.x - geometry.a.x, y: geometry.c.y - geometry.a.y },
        end: { x: geometry.d.x - geometry.b.x, y: geometry.d.y - geometry.b.y },
    }
    const point = placePoint(model, position.x, position.y)
    const endpoint = handle === 'start' ? geometry.a : geometry.b
    segment.handles[handle] = { x: point.x - endpoint.x, y: point.y - endpoint.y }
    return next
}

export function insertTrackPoint(model, index, point, t) {
    const source = trackSegments(model)[index]
    if (!source || !Number.isFinite(t) || t < 0 || t > 1) throw new Error('Invalid segment insertion')
    const next = structuredClone(model)
    next.points.splice(index + 1, 0, structuredClone(point))
    syncTrackSegments(next)
    const left = next.segments[index], right = next.segments[index + 1]
    left.id = source.id
    left.shape = right.shape = source.shape
    left.styleId = right.styleId = model.segments[index].styleId
    if (source.shape === 'curve') {
        const lerp = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
        const offset = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
        const ac = lerp(source.a, source.c), cd = lerp(source.c, source.d), db = lerp(source.d, source.b)
        const leftEnd = lerp(ac, cd), rightStart = lerp(cd, db), middle = lerp(leftEnd, rightStart)
        left.handles = { start: offset(ac, source.a), end: offset(leftEnd, middle) }
        right.handles = { start: offset(rightStart, middle), end: offset(db, source.b) }
    }
    return next
}

export function setTrackSegmentStyle(model, id, styleId) {
    if (styleId !== null && !model.styles.some(style => style.id === styleId)) throw new Error('Missing road style')
    const next = structuredClone(model)
    const segment = next.segments.find(segment => segment.id === id)
    if (!segment) throw new Error('Missing segment')
    segment.styleId = styleId
    return next
}

export function addTrackStyle(model) {
    const next = structuredClone(model)
    const names = new Set(model.styles.map(style => style.name.toLowerCase()))
    let number = 1
    while (names.has(`road style ${number}`)) number++
    next.styles.push({ id: crypto.randomUUID(), name: `Road style ${number}`, roadColor: model.rendering.roadColor, roadWidth: model.rendering.roadWidth })
    return validateBlueprint(next)
}

export function updateTrackStyle(model, id, name, roadColor, roadWidth) {
    const next = structuredClone(model)
    const style = next.styles.find(style => style.id === id)
    if (!style) throw new Error('Missing road style')
    style.name = name
    style.roadColor = roadColor
    style.roadWidth = roadWidth
    return validateBlueprint(next)
}

export function removeTrackStyle(model, id) {
    if (!model.styles.some(style => style.id === id)) throw new Error('Missing road style')
    if (model.segments.some(segment => segment.styleId === id)) throw new Error('Road style is in use; change its segments to another style first')
    const next = structuredClone(model)
    next.styles = next.styles.filter(style => style.id !== id)
    return next
}
