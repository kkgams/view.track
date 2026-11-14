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
