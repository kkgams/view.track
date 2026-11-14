import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBlueprint, syncTrackSegments } from '../src/model.mjs'
import { pointsInBox, moveTrackSelection, zoomTrackCamera, fitTrackCamera } from '../src/interaction.mjs'

function near(actual, expected) {
    assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
}
function cameraNear(actual, expected) {
    for (const key of ['x', 'y', 'width', 'height']) near(actual[key], expected[key])
}
function model() {
    const value = createBlueprint()
    value.viewport = { width: 300, height: 200 }
    value.settings.snap = false
    value.points = [{ id: 'a', x: 23, y: 77 }, { id: 'b', x: 87, y: 113 }, { id: 'c', x: 150, y: 80 }]
    return syncTrackSegments(value)
}
function translation(value, ids, delta, dx, dy) {
    const before = structuredClone(value)
    const next = moveTrackSelection(value, ids, delta)
    assert.deepEqual(next.points, before.points.map(p => ids.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p))
    assert.deepEqual({ ...next, points: before.points }, before)
    assert.deepEqual(value, before)
    return next
}
function contains(camera, points, padding) {
    for (const p of points) {
        assert.ok(camera.x <= p.x - padding + 1e-9)
        assert.ok(camera.y <= p.y - padding + 1e-9)
        assert.ok(camera.x + camera.width >= p.x + padding - 1e-9)
        assert.ok(camera.y + camera.height >= p.y + padding - 1e-9)
    }
}

for (const [x1, x2] of [[10, 30], [30, 10]]) for (const [y1, y2] of [[20, 40], [40, 20]]) {
    test(`rectangle is inclusive in direction ${x1},${y1} to ${x2},${y2}`, () => {
        const points = [[10, 20], [30, 20], [10, 40], [30, 40], [20, 30], [10, 30], [9.99, 30], [30.01, 30], [20, 19.99], [20, 40.01]].map(([x, y], id) => ({ id: String(id), x, y }))
        const before = structuredClone(points)
        assert.deepEqual(pointsInBox(points, { x: x1, y: y1 }, { x: x2, y: y2 }), new Set(['0', '1', '2', '3', '4', '5']))
        assert.deepEqual(points, before)
    })
}
test('rectangle unions additive selection without duplicates or base mutation', () => {
    const points = [{ id: 'a', x: 10, y: 20 }, { id: 'b', x: 30, y: 40 }]
    const base = new Set(['a', 'outside'])
    const selected = pointsInBox(points, { x: 0, y: 0 }, { x: 40, y: 50 }, base)
    assert.deepEqual(selected, new Set(['a', 'b', 'outside']))
    selected.add('new')
    assert.deepEqual(base, new Set(['a', 'outside']))
    assert.deepEqual(pointsInBox([], { x: 0, y: 0 }, { x: 0, y: 0 }, base), base)
    assert.deepEqual(pointsInBox(points, { x: 10, y: 20 }, { x: 10, y: 20 }), new Set(['a']))
})

test('unsnapped group translation is rigid and preserves fractional movement', () => {
    translation(model(), new Set(['a', 'b']), { x: 12.25, y: -9.5 }, 12.25, -9.5)
})
for (const [delta, dx, dy] of [[{ x: 26, y: -26 }, 40, -40], [{ x: 19, y: 19 }, 0, 0]]) {
    test(`group snaps common delta ${JSON.stringify(delta)} rather than individual coordinates`, () => {
        const value = model()
        value.settings.snap = true
        translation(value, new Set(['a', 'b']), delta, dx, dy)
    })
}
for (const [x, y, dx, dy] of [[-1000, -1000, -23, -77], [1000, 1000, 213, 87], [-1000, 1000, -23, 87], [1000, -1000, 213, -77]]) {
    test(`group boundary clamp is common and rigid for ${x},${y}`, () => {
        translation(model(), new Set(['a', 'b']), { x, y }, dx, dy)
    })
}
test('common boundary clamp follows snapping even when boundary is off grid', () => {
    const value = model()
    value.settings.snap = true
    translation(value, new Set(['a', 'b']), { x: -1000, y: 1000 }, -23, 87)
})
test('movement retains metadata and deeply isolates all original model state', () => {
    const value = model()
    value.extension = { values: [1] }
    value.points[0].extension = { elevation: 8 }
    value.annotations = [{ nested: { text: 'keep' } }]
    const before = structuredClone(value)
    const next = translation(value, new Set(['a', 'b']), { x: 10, y: 5 }, 10, 5)
    next.extension.values.push(2)
    next.points[0].extension.elevation = 99
    next.points[2].x = 0
    next.annotations[0].nested.text = 'edit'
    next.settings.snap = true
    next.rendering.roadWidth = 99
    next.viewport.width = 400
    assert.deepEqual(value, before)
})
for (const ids of [new Set(), new Set(['missing'])]) test(`empty effective selection ${[...ids]} is an independent no-op`, () => {
    const value = model(), next = translation(value, ids, { x: 100, y: 100 }, 0, 0)
    assert.notEqual(next, value)
    next.points[0].x = 999
    assert.equal(value.points[0].x, 23)
})

for (const factor of [0.25, 1, 2, 100000, 0.000001]) test(`zoom preserves anchor and clamps scale at factor ${factor}`, () => {
    const viewport = { width: 1200, height: 800 }
    const camera = { x: -250, y: 75, width: 600, height: 400 }, anchor = { x: 43.25, y: 199.5 }
    const before = structuredClone({ camera, viewport, anchor })
    const next = zoomTrackCamera(camera, viewport, anchor, factor)
    near((anchor.x - next.x) * viewport.width / next.width, (anchor.x - camera.x) * viewport.width / camera.width)
    near((anchor.y - next.y) * viewport.height / next.height, (anchor.y - camera.y) * viewport.height / camera.height)
    near(next.width / next.height, viewport.width / viewport.height)
    near(viewport.width / next.width, Math.max(0.02, Math.min(64, 2 * factor)))
    assert.deepEqual({ camera, viewport, anchor }, before)
})
test('zoom beyond either limit is idempotent', () => {
    const viewport = { width: 1200, height: 800 }, anchor = { x: -100, y: 200 }
    for (const [scale, factor] of [[0.02, 0.5], [64, 2]]) {
        const camera = { x: -400, y: 30, width: viewport.width / scale, height: viewport.height / scale }
        cameraNear(zoomTrackCamera(camera, viewport, anchor, factor), camera)
    }
})
test('one thousand reciprocal zoom cycles at changing anchors do not drift', () => {
    const viewport = { width: 1200, height: 800 }
    const original = { x: -123.5, y: 47.25, width: 900, height: 600 }
    let camera = { ...original }
    for (let index = 0; index < 1000; index++) {
        const anchor = { x: index % 317 - 100, y: index % 193 + 0.25 }
        camera = zoomTrackCamera(camera, viewport, anchor, 1.2)
        camera = zoomTrackCamera(camera, viewport, anchor, 1 / 1.2)
    }
    cameraNear(camera, original)
})
test('empty fit restores document viewport regardless of padding', () => {
    const viewport = { width: 1200, height: 800 }
    for (const padding of [undefined, 0, 200]) assert.deepEqual(fitTrackCamera([], viewport, padding), { x: 0, y: 0, width: 1200, height: 800 })
})
test('single point fits centered with default padding', () => {
    cameraNear(fitTrackCamera([{ x: 300, y: 200 }], { width: 1200, height: 800 }), { x: 240, y: 160, width: 120, height: 80 })
})
for (const viewport of [{ width: 1200, height: 800 }, { width: 400, height: 1200 }]) {
    for (const points of [
        [{ x: -100, y: 30 }, { x: 700, y: 90 }, { x: 0, y: 50 }],
        [{ x: 30, y: -100 }, { x: 90, y: 700 }, { x: 50, y: 0 }],
    ]) test(`fit all bounds with aspect ${viewport.width}/${viewport.height}: ${JSON.stringify(points)}`, () => {
        const before = structuredClone({ points, viewport })
        const camera = fitTrackCamera(points, viewport, 40)
        const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x))
        const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y))
        contains(camera, points, 40)
        near(camera.width / camera.height, viewport.width / viewport.height)
        near(camera.x + camera.width / 2, (minX + maxX) / 2)
        near(camera.y + camera.height / 2, (minY + maxY) / 2)
        // One axis fits exactly; the other expands only to preserve aspect ratio.
        near(Math.min(camera.width - (maxX - minX + 80), camera.height - (maxY - minY + 80)), 0)
        assert.deepEqual({ points, viewport }, before)
    })
}
test('explicit stroke padding reserves outer road stroke and margin around every point', () => {
    const value = model()
    Object.assign(value.rendering, { roadWidth: 150, edgeWidth: 25, outlineWidth: 10 })
    const radius = value.rendering.roadWidth / 2 + value.rendering.edgeWidth + value.rendering.outlineWidth
    const camera = fitTrackCamera(value.points, value.viewport, radius + 40)
    contains(camera, value.points, radius + 40)
    near(camera.width / camera.height, value.viewport.width / value.viewport.height)
})
for (const [points, padding, scale] of [
    [[{ x: 10, y: 20 }, { x: 10.01, y: 20.01 }], 0.001, 64],
    [[{ x: -100000, y: -100000 }, { x: 100000, y: 100000 }], 40, 0.02],
]) test(`fit clamps scale to ${scale} and retains bounds center`, () => {
    const viewport = { width: 1200, height: 800 }, camera = fitTrackCamera(points, viewport, padding)
    near(viewport.width / camera.width, scale)
    near(camera.width / camera.height, viewport.width / viewport.height)
    near(camera.x + camera.width / 2, (points[0].x + points[1].x) / 2)
    near(camera.y + camera.height / 2, (points[0].y + points[1].y) / 2)
})
test('zero-padding singleton fit remains finite and clamps to maximum zoom', () => {
    const camera = fitTrackCamera([{ x: 10, y: 20 }], { width: 1200, height: 800 }, 0)
    cameraNear(camera, { x: 10 - 1200 / 64 / 2, y: 20 - 800 / 64 / 2, width: 1200 / 64, height: 800 / 64 })
})
