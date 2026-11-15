import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBlueprint, placePoint, TrackHistory, syncTrackSegments } from '../src/model.mjs'
import { trackSegments, segmentPoint, trackPath, nearestSegment } from '../src/geometry.mjs'

function blueprint(coordinates, settings = {}) {
    const value = createBlueprint()
    const { shape = 'curve', closed = true, ...routeSettings } = settings
    value.settings = { ...value.settings, ...routeSettings }
    value.points = coordinates.map(([x, y], index) => ({ id: String(index), x, y }))
    value.roads = value.points.length ? [{ id: 'road-1', closed, pointIds: value.points.map(point => point.id) }] : []
    syncTrackSegments(value)
    value.segments.forEach(segment => { segment.shape = shape })
    return value
}
function near(actual, expected, epsilon = 1e-9) {
    assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`)
}

test('empty and single-point tracks have no segments or insertion target', () => {
    const empty = blueprint([])
    assert.deepEqual(trackSegments(empty), [])
    assert.equal(trackPath(empty), '')
    assert.equal(nearestSegment(empty, { x: 0, y: 0 }), null)
    const single = blueprint([[10, 20]])
    assert.deepEqual(trackSegments(single), [])
    assert.equal(trackPath(single), 'M 10 20')
    assert.equal(nearestSegment(single, { x: 10, y: 20 }), null)
})
test('two points never create a closing edge, even with closed enabled', () => {
    for (const shape of ['curve', 'straight']) {
        const value = blueprint([[0, 0], [60, 60]], { shape })
        const segments = trackSegments(value)
        assert.equal(segments.length, 1)
        assert.doesNotMatch(trackPath(value), /Z/)
        assert.deepEqual(segmentPoint(segments[0], 0), { x: 0, y: 0 })
        assert.deepEqual(segmentPoint(segments[0], 1), { x: 60, y: 60 })
        assert.deepEqual(segmentPoint(segments[0], 0.5), { x: 30, y: 30 })
    }
})
test('open Catmull-Rom curves clamp neighbors at the endpoints', () => {
    const value = blueprint([[0, 0], [60, 60], [120, 0]], { closed: false })
    const [first, second] = trackSegments(value)
    assert.deepEqual(first.c, { x: 10, y: 10 })
    assert.deepEqual(first.d, { x: 40, y: 60 })
    assert.deepEqual(second.c, { x: 80, y: 60 })
    assert.deepEqual(second.d, { x: 110, y: 10 })
    assert.equal(trackPath(value), 'M 0 0 C 10 10 40 60 60 60 C 80 60 110 10 120 0')
})
test('closed curves wrap neighbors and join tangent directions at the seam', () => {
    const value = blueprint([[0, 0], [60, 60], [120, 0]])
    const segments = trackSegments(value)
    assert.equal(segments.length, 3)
    const first = segments[0], last = segments[2]
    assert.equal(last.index, 2)
    assert.deepEqual(last.b, first.a)
    assert.deepEqual(first.c, { x: -10, y: 10 })
    assert.deepEqual(last.c, { x: 110, y: -10 })
    assert.deepEqual(last.d, { x: 10, y: -10 })
    near(first.c.x - first.a.x, last.b.x - last.d.x)
    near(first.c.y - first.a.y, last.b.y - last.d.y)
    assert.match(trackPath(value), / C 110 -10 10 -10 0 0 Z$/)
})
test('straight paths use lines, close only when requested, and preserve point order', () => {
    const value = blueprint([[0, 0], [100, 0], [100, 100]], { shape: 'straight' })
    assert.equal(trackPath(value), 'M 0 0 L 100 0 L 100 100 L 0 0 Z')
    const first = trackSegments(value)[0]
    assert.deepEqual(first.c, first.a)
    assert.deepEqual(first.d, first.b)
    value.roads[0].closed = false
    syncTrackSegments(value)
    assert.equal(trackPath(value), 'M 0 0 L 100 0 L 100 100')
})
test('cubic evaluation agrees with an independently calculated midpoint and endpoints', () => {
    const segment = { a: { x: 0, y: 0 }, c: { x: 0, y: 100 }, d: { x: 100, y: 100 }, b: { x: 100, y: 0 } }
    assert.deepEqual(segmentPoint(segment, 0), segment.a)
    assert.deepEqual(segmentPoint(segment, 1), segment.b)
    assert.deepEqual(segmentPoint(segment, 0.5), { x: 50, y: 75 })
})
test('path serialization rounds coordinates without mutating authored values', () => {
    const value = blueprint([[1.123456, -0.00001], [2.99999, 4.123456]], { shape: 'straight', closed: false })
    const before = structuredClone(value)
    assert.equal(trackPath(value), 'M 1.123 0 L 3 4.123')
    assert.deepEqual(value, before)
})
test('fully coincident points produce finite curves and a deterministic nearest result', () => {
    for (const shape of ['curve', 'straight']) for (const closed of [true, false]) {
        const value = blueprint([[30, 40], [30, 40], [30, 40]], { shape, closed })
        assert.doesNotMatch(trackPath(value), /NaN|Infinity/)
        for (const segment of trackSegments(value)) assert.deepEqual(segmentPoint(segment, 0.5), { x: 30, y: 40 })
        assert.deepEqual(nearestSegment(value, { x: 33, y: 44 }), { index: 0, x: 30, y: 40, distance: 5 })
    }
})
test('nearest straight segment projects inside an edge and clamps beyond an endpoint', () => {
    const value = blueprint([[0, 0], [100, 0]], { shape: 'straight', closed: false })
    const middle = nearestSegment(value, { x: 37, y: 8 })
    assert.equal(middle.index, 0)
    near(middle.x, 37)
    near(middle.y, 0)
    near(middle.distance, 8)
    assert.deepEqual(nearestSegment(value, { x: -3, y: 4 }), { index: 0, x: 0, y: 0, distance: 5 })
    assert.deepEqual(nearestSegment(value, { x: 103, y: 4 }), { index: 0, x: 100, y: 0, distance: 5 })
})
test('nearest smooth segment picks rendered curve instead of its control-point chord', () => {
    const value = blueprint([[0, 0], [60, 60], [120, 0]], { closed: false })
    const point = segmentPoint(trackSegments(value)[0], 0.5)
    const hit = nearestSegment(value, point)
    assert.equal(hit.index, 0)
    near(hit.distance, 0)
    near(hit.x, point.x)
    near(hit.y, point.y)
    assert.notEqual(point.x, point.y)
})
test('closing-edge insertion appends between last and first, snaps, and remains undoable', () => {
    const value = blueprint([[0, 0], [200, 0], [200, 200]], { shape: 'straight', gridSize: 40 })
    const history = new TrackHistory(value)
    const hit = nearestSegment(history.model, { x: 97, y: 103 })
    assert.equal(hit.index, 2)
    near(hit.x, 100)
    near(hit.y, 100)
    const next = structuredClone(history.model)
    next.points.splice(hit.index + 1, 0, { id: 'inserted', ...placePoint(next, hit.x, hit.y) })
    next.roads[0].pointIds.splice(hit.index + 1, 0, 'inserted')
    syncTrackSegments(next)
    assert.equal(history.commit(next), true)
    assert.deepEqual(history.model.points.map(point => point.id), ['0', '1', '2', 'inserted'])
    assert.deepEqual(history.model.points[3], { id: 'inserted', x: 120, y: 120 })
    assert.equal(trackSegments(history.model).at(-1).b.id, '0')
    history.undo()
    assert.deepEqual(history.model, value)
    history.redo()
    assert.equal(history.model.points.length, 4)
    value.roads[0].closed = false
    syncTrackSegments(value)
    assert.equal(nearestSegment(value, { x: 97, y: 103 }).index, 0)
})
test('geometry queries do not modify extension metadata or model state', () => {
    const value = blueprint([[10, 20], [90, 100], [200, 30]])
    value.points[1].extension = { label: 'preserve' }
    value.annotations = [{ text: 'preserve' }]
    const before = structuredClone(value)
    trackSegments(value)
    trackPath(value)
    nearestSegment(value, { x: 20, y: 30 })
    assert.deepEqual(value, before)
})
