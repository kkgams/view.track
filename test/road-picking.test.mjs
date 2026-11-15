import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBlueprint, syncTrackSegments } from '../src/model.mjs'
import { nearestSegment } from '../src/geometry.mjs'

function road() {
    const model = createBlueprint()
    model.points = [{ id: 'a', x: 100, y: 200 }, { id: 'b', x: 500, y: 200 }, { id: 'c', x: 900, y: 200 }]
    model.roads = [{ id: 'road-1', closed: false, pointIds: model.points.map(point => point.id) }]
    syncTrackSegments(model)
    for (const segment of model.segments) segment.shape = 'straight'
    model.rendering.edgeWidth = 0
    model.rendering.outlineWidth = 0
    return model
}

test('road picking follows tapered style widths and includes the visible shoulders', () => {
    const model = road()
    model.styles.push({ id: 'wide', name: 'Wide', roadWidth: 200, roadColor: '#123456' })
    model.segments[0].styleId = 'wide'
    assert.equal(nearestSegment(model, { x: 300, y: 290 }, true, 0).index, 0)
    assert.equal(nearestSegment(model, { x: 700, y: 290 }, true, 0), null)
    assert.equal(nearestSegment(model, { x: 700, y: 215 }, true, 0), null)
    model.rendering.edgeWidth = 5
    assert.equal(nearestSegment(model, { x: 700, y: 215 }, true, 0).index, 1)
})

test('picking tolerance is in document units and centerline mode ignores hidden road width', () => {
    const model = road()
    model.rendering.roadWidth = 200
    model.rendering.mode = 'centerline'
    assert.equal(nearestSegment(model, { x: 300, y: 280 }, true, 0), null)
    assert.equal(nearestSegment(model, { x: 300, y: 210 }, true, 0), null)
    const hit = nearestSegment(model, { x: 300, y: 210 }, true, 6)
    assert.equal(hit.index, 0)
    assert.equal(hit.t, 0.5)
    assert.equal(nearestSegment(model, { x: 300, y: 210 }, true, 3), null)
})

test('road picking remains finite for coincident points', () => {
    const model = road()
    model.points[1] = { ...model.points[0], id: 'b' }
    const hit = nearestSegment(model, { x: 100, y: 200 }, true, 0)
    assert.equal(hit.distance, 0)
    assert.equal(hit.t, 0)
})
