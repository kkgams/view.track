import { trackSegments } from "./geometry.mjs"
import { placePoint, syncTrackSegments, trackRoads, validateBlueprint } from "./model.mjs"

// Selection and camera state are session-only; neither changes the SVG document schema.
export function pointsInBox(points, start, end, base = []) {
    const minX = Math.min(start.x, end.x),
        maxX = Math.max(start.x, end.x)
    const minY = Math.min(start.y, end.y),
        maxY = Math.max(start.y, end.y)
    return new Set([
        ...base,
        ...points
            .filter((point) => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY)
            .map((point) => point.id),
    ])
}

export function moveTrackSelection(model, ids, delta) {
    const next = structuredClone(model)
    const selected = model.points.filter((point) => ids.has(point.id))
    if (!selected.length) return next
    const step = model.settings.gridSize
    const snap = (value) => (model.settings.snap ? Math.round(value / step) * step : value)
    // Clamp one common translation, never individual points: relative distances stay intact.
    const clamp = (value, low, high) => (low <= high ? Math.max(low, Math.min(high, value)) : value)
    const xs = selected.map((point) => point.x),
        ys = selected.map((point) => point.y)
    const dx = clamp(snap(delta.x), -Math.min(...xs), model.viewport.width - Math.max(...xs))
    const dy = clamp(snap(delta.y), -Math.min(...ys), model.viewport.height - Math.max(...ys))
    for (const point of next.points)
        if (ids.has(point.id)) {
            point.x += dx
            point.y += dy
        }
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
    return {
        x: anchor.x - (anchor.x - camera.x) / change,
        y: anchor.y - (anchor.y - camera.y) / change,
        width: camera.width / change,
        height: camera.height / change,
    }
}

export function fitTrackCamera(points, viewport, padding = 40) {
    if (!points.length) return { x: 0, y: 0, width: viewport.width, height: viewport.height }
    const xs = points.map((point) => point.x),
        ys = points.map((point) => point.y)
    const minX = Math.min(...xs),
        maxX = Math.max(...xs),
        minY = Math.min(...ys),
        maxY = Math.max(...ys)
    const width = Math.max(
        viewport.width / 64,
        maxX - minX + padding * 2,
        ((maxY - minY + padding * 2) * viewport.width) / viewport.height,
    )
    const height = (width * viewport.height) / viewport.width
    const camera = { x: (minX + maxX - width) / 2, y: (minY + maxY - height) / 2, width, height }
    return zoomTrackCamera(camera, viewport, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, 1)
}

export function editTrackSegment(model, id, shape) {
    if (!["straight", "curve"].includes(shape)) throw new Error("Invalid segment shape")
    const next = structuredClone(model)
    const segment = next.segments.find((segment) => segment.id === id)
    if (!segment) throw new Error("Missing segment")
    segment.shape = shape
    return next
}

export function resetTrackHandles(model, id) {
    const next = structuredClone(model)
    const segment = next.segments.find((segment) => segment.id === id)
    if (!segment) throw new Error("Missing segment")
    segment.handles = null
    return next
}

export function moveTrackHandle(model, id, handle, position) {
    if (!["start", "end"].includes(handle)) throw new Error("Invalid curve handle")
    const geometry = trackSegments(model).find((segment) => segment.id === id)
    if (geometry?.shape !== "curve") throw new Error("Missing curved segment")
    const next = structuredClone(model)
    const segment = next.segments[geometry.index]
    if (segment.handles === null)
        segment.handles = {
            start: { x: geometry.c.x - geometry.a.x, y: geometry.c.y - geometry.a.y },
            end: { x: geometry.d.x - geometry.b.x, y: geometry.d.y - geometry.b.y },
        }
    const point = placePoint(model, position.x, position.y)
    const endpoint = handle === "start" ? geometry.a : geometry.b
    segment.handles[handle] = { x: point.x - endpoint.x, y: point.y - endpoint.y }
    return next
}

export function insertTrackPoint(model, index, point, t) {
    const source = trackSegments(model)[index]
    if (!source || !Number.isFinite(t) || t < 0 || t > 1) throw new Error("Invalid segment insertion")
    const next = structuredClone(model)
    const road = next.roads.find((road) => road.pointIds.includes(source.a.id))
    if (!road) throw new Error("Segment has no road")
    const roadIndex = road.pointIds.indexOf(source.a.id)
    road.pointIds.splice(roadIndex + 1, 0, point.id)
    const pointIndex = next.points.findIndex((point) => point.id === source.a.id)
    next.points.splice(pointIndex + 1, 0, structuredClone(point))
    syncTrackSegments(next)
    const left = next.segments[index],
        right = next.segments[index + 1]
    left.id = source.id
    left.shape = right.shape = source.shape
    left.styleId = right.styleId = model.segments[index].styleId
    if (source.shape === "curve") {
        const lerp = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
        const offset = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
        const ac = lerp(source.a, source.c),
            cd = lerp(source.c, source.d),
            db = lerp(source.d, source.b)
        const leftEnd = lerp(ac, cd),
            rightStart = lerp(cd, db),
            middle = lerp(leftEnd, rightStart)
        left.handles = { start: offset(ac, source.a), end: offset(leftEnd, middle) }
        right.handles = { start: offset(rightStart, middle), end: offset(db, source.b) }
    }
    return next
}

// Outside the road, only an open endpoint continues an existing route.
// Inserting within a road remains a separate on-road picking operation.
export function addTrackPoint(model, point, originId = null) {
    const next = structuredClone(model)
    let road = null
    if (originId !== null) {
        road = next.roads.find((road) => road.pointIds.includes(originId))
        if (!road) throw new Error("Missing drawing origin")
        if (!isTrackEndpoint(road, originId)) road = null
    }
    if (road === null) {
        next.points.push(structuredClone(point))
        next.roads.push({ id: crypto.randomUUID(), closed: false, pointIds: [point.id] })
    } else {
        const index = next.points.findIndex((point) => point.id === originId)
        if (index === -1) throw new Error("Missing drawing origin")
        const prepend = road.pointIds.length > 1 && road.pointIds[0] === originId
        road.pointIds.splice(prepend ? 0 : road.pointIds.length, 0, point.id)
        road.closed = false
        next.points.splice(prepend ? index : index + 1, 0, structuredClone(point))
    }
    return syncTrackSegments(next)
}

export function deleteTrackPoints(model, ids) {
    const next = structuredClone(model)
    next.points = next.points.filter((point) => !ids.has(point.id))
    for (const road of next.roads) road.pointIds = road.pointIds.filter((id) => !ids.has(id))
    next.roads = next.roads.filter((road) => road.pointIds.length)
    return syncTrackSegments(next)
}

function trackPointRoad(roads, pointId) {
    const road = roads.find((road) => road.pointIds.includes(pointId))
    if (!road) throw new Error("Missing track point")
    return road
}

function isTrackLoop(road) {
    return road.closed && road.pointIds.length > 2
}

function isTrackEndpoint(road, pointId) {
    return !isTrackLoop(road) && (road.pointIds[0] === pointId || road.pointIds.at(-1) === pointId)
}

// Cutting removes incident edges rather than bridging the gap as deletion does.
export function splitTrackPoint(model, pointId) {
    const next = validateBlueprint(model)
    const road = trackPointRoad(next.roads, pointId)
    const index = road.pointIds.indexOf(pointId)
    const before = road.pointIds.slice(0, index),
        after = road.pointIds.slice(index + 1)
    next.points = next.points.filter((point) => point.id !== pointId)
    if (road.closed) {
        road.pointIds = [...after, ...before]
        road.closed = false
    } else if (before.length && after.length) {
        const tail = { ...structuredClone(road), id: crypto.randomUUID(), pointIds: after }
        road.pointIds = before
        next.roads.splice(next.roads.indexOf(road) + 1, 0, tail)
    } else road.pointIds = [...before, ...after]
    next.roads = next.roads.filter((road) => road.pointIds.length)
    return syncTrackSegments(next)
}

function reverseTrackRoad(model, road) {
    const ids = new Set(road.pointIds)
    road.pointIds.reverse()
    for (const segment of model.segments)
        if (ids.has(segment.from) && ids.has(segment.to)) {
            ;[segment.from, segment.to] = [segment.to, segment.from]
            if (segment.handles !== null)
                segment.handles = {
                    ...segment.handles,
                    start: segment.handles.end,
                    end: segment.handles.start,
                }
        }
}

export function canJoinTrackEndpoints(model, sourceId, targetId) {
    const source = trackPointRoad(model.roads, sourceId),
        target = trackPointRoad(model.roads, targetId)
    return source !== target && isTrackEndpoint(source, sourceId) && isTrackEndpoint(target, targetId)
}

function prepareTrackJoin(model, sourceId, targetId) {
    const next = validateBlueprint(model)
    const source = trackPointRoad(next.roads, sourceId),
        target = trackPointRoad(next.roads, targetId)
    if (!canJoinTrackEndpoints(next, sourceId, targetId)) {
        throw new Error("Joining requires endpoints of different open roads")
    }
    if (source.pointIds.at(-1) !== sourceId) reverseTrackRoad(next, source)
    if (target.pointIds[0] !== targetId) reverseTrackRoad(next, target)
    return { next, source, target }
}

// Clicking creates a new connection; both existing endpoints stay in place.
export function connectTrackEndpoints(model, sourceId, targetId) {
    const { next, source, target } = prepareTrackJoin(model, sourceId, targetId)
    target.pointIds = [...source.pointIds, ...target.pointIds]
    target.closed = false
    next.roads = next.roads.filter((road) => road !== source)
    return syncTrackSegments(next)
}

// Dropping a dragged endpoint welds it to the destination, retaining one point.
export function mergeTrackEndpoints(model, sourceId, targetId) {
    const { next, source, target } = prepareTrackJoin(model, sourceId, targetId)
    target.pointIds = [...source.pointIds.slice(0, -1), ...target.pointIds]
    target.closed = false
    for (const segment of next.segments) {
        if (segment.from === sourceId) segment.from = targetId
        if (segment.to === sourceId) segment.to = targetId
    }
    next.points = next.points.filter((point) => point.id !== sourceId)
    next.roads = next.roads.filter((road) => road !== source)
    return syncTrackSegments(next)
}

export function trackMergeTarget(model, sourceId, position, tolerance) {
    if (
        !position ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        !Number.isFinite(tolerance) ||
        tolerance < 0
    ) {
        throw new Error("Invalid merge picking position or tolerance")
    }
    const roads = trackRoads(model),
        source = trackPointRoad(roads, sourceId)
    if (!isTrackEndpoint(source, sourceId)) return null
    const endpoints = new Set(
        roads
            .filter((road) => road.id !== source.id && !isTrackLoop(road))
            .flatMap((road) => [road.pointIds[0], road.pointIds.at(-1)]),
    )
    let target = null,
        nearest = tolerance
    for (const point of model.points)
        if (endpoints.has(point.id)) {
            const distance = Math.hypot(point.x - position.x, point.y - position.y)
            if (distance <= nearest && (target === null || distance < nearest)) {
                target = point.id
                nearest = distance
            }
        }
    return target
}

export function setTrackSegmentStyle(model, id, styleId) {
    if (styleId !== null && !model.styles.some((style) => style.id === styleId)) throw new Error("Missing road style")
    const next = structuredClone(model)
    const segment = next.segments.find((segment) => segment.id === id)
    if (!segment) throw new Error("Missing segment")
    segment.styleId = styleId
    return next
}

export function addTrackStyle(model) {
    const next = structuredClone(model)
    const names = new Set(model.styles.map((style) => style.name.toLowerCase()))
    let number = 1
    while (names.has(`road style ${number}`)) number++
    next.styles.push({
        id: crypto.randomUUID(),
        name: `Road style ${number}`,
        roadColor: model.rendering.roadColor,
        roadWidth: model.rendering.roadWidth,
    })
    return validateBlueprint(next)
}

export function updateTrackStyle(model, id, name, roadColor, roadWidth) {
    const next = structuredClone(model)
    const style = next.styles.find((style) => style.id === id)
    if (!style) throw new Error("Missing road style")
    style.name = name
    style.roadColor = roadColor
    style.roadWidth = roadWidth
    return validateBlueprint(next)
}

export function removeTrackStyle(model, id) {
    if (!model.styles.some((style) => style.id === id)) throw new Error("Missing road style")
    if (model.segments.some((segment) => segment.styleId === id))
        throw new Error("Road style is in use; change its segments to another style first")
    const next = structuredClone(model)
    next.styles = next.styles.filter((style) => style.id !== id)
    return next
}
