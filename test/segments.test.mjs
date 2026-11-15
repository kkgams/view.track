import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBlueprint, syncTrackSegments, validateBlueprint, TrackHistory } from '../src/model.mjs'
import { trackSegments, trackPath, segmentPoint, nearestSegment } from '../src/geometry.mjs'
import { editTrackSegment, resetTrackHandles, moveTrackHandle, moveTrackSelection, insertTrackPoint, setTrackSegmentStyle } from '../src/interaction.mjs'
import { exportBlueprint } from '../src/svg.mjs'

function blueprint() {
    const model = createBlueprint()
    model.settings.closed = true
    model.settings.snap = false
    model.points = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 400, y: 100 }, { id: 'c', x: 400, y: 400 }]
    return syncTrackSegments(model)
}

test('mixed segment shapes generate independent line and cubic commands including closing edge', () => {
    const model = blueprint()
    const next = editTrackSegment(model, model.segments[0].id, 'straight')
    const closed = editTrackSegment(next, next.segments[2].id, 'straight')
    assert.match(trackPath(closed), /^M 100 100 L 400 100 C .* L 100 100 Z$/)
    assert.equal(model.segments[0].shape, 'curve')
    assert.deepEqual(closed.segments[1], model.segments[1])
    assert.equal(trackSegments(closed)[0].c, closed.points[0])
})

test('editing one curve handle materializes the other automatic handle and leaves neighbors untouched', () => {
    const model = blueprint()
    const [original, ...neighbors] = trackSegments(model)
    const next = moveTrackHandle(model, original.id, 'start', { x: 180, y: 250 })
    const [edited, ...after] = trackSegments(next)
    assert.deepEqual(edited.c, { x: 180, y: 250 })
    assert.deepEqual(edited.d, original.d)
    assert.deepEqual(after, neighbors)
    assert.equal(model.segments[0].handles, null)
    assert.deepEqual(validateBlueprint(next), next)
    const hit = nearestSegment(next, segmentPoint(edited, 0.5))
    assert.equal(hit.index, 0)
    assert.ok(hit.distance < 1e-9)
})

test('curve handles belong to the segment and survive shape toggles', () => {
    let model = blueprint()
    const id = model.segments[0].id
    model = moveTrackHandle(model, id, 'end', { x: 350, y: 260 })
    const handles = structuredClone(model.segments[0].handles)
    const straight = editTrackSegment(model, id, 'straight')
    assert.deepEqual(straight.segments[0].handles, handles)
    assert.deepEqual(trackSegments(straight)[0].d, straight.points[1])
    const curve = editTrackSegment(straight, id, 'curve')
    assert.deepEqual(trackSegments(curve)[0].d, { x: 350, y: 260 })
    assert.deepEqual(curve.segments[1], model.segments[1])
})

test('handles follow their endpoint on movement without changing segment-relative offsets', () => {
    const model = blueprint()
    const id = model.segments[0].id
    const manual = moveTrackHandle(model, id, 'start', { x: 160, y: 200 })
    const moved = moveTrackSelection(manual, new Set(['a']), { x: 20, y: 30 })
    assert.deepEqual(moved.segments, manual.segments)
    assert.deepEqual(trackSegments(moved)[0].c, { x: 180, y: 230 })
    assert.deepEqual(trackSegments(moved)[0].d, trackSegments(manual)[0].d)
})

test('reset restores current automatic geometry and is fully undoable with shape and handles', () => {
    const initial = blueprint()
    const id = initial.segments[0].id
    const history = new TrackHistory(initial)
    const manual = moveTrackHandle(initial, id, 'start', { x: 180, y: 250 })
    history.commit(manual)
    history.commit(editTrackSegment(history.model, id, 'straight'))
    history.commit(editTrackSegment(history.model, id, 'curve'))
    history.commit(resetTrackHandles(history.model, id))
    assert.deepEqual(trackSegments(history.model), trackSegments(initial))
    history.undo()
    assert.deepEqual(history.model, manual)
    history.undo()
    assert.equal(history.model.segments[0].shape, 'straight')
    history.redo()
    history.redo()
    assert.equal(history.model.segments[0].handles, null)
    assert.equal(history.commit(resetTrackHandles(history.model, id)), false)
})

test('topology synchronization preserves unaffected segment IDs and authored handles, removes dangling records', () => {
    let model = blueprint()
    model = moveTrackHandle(model, model.segments[0].id, 'start', { x: 180, y: 250 })
    const kept = structuredClone(model.segments[0])
    model.points.splice(2, 0, { id: 'inserted', x: 500, y: 250 })
    syncTrackSegments(model)
    assert.deepEqual(model.segments[0], kept)
    assert.equal(model.segments.length, 4)
    assert.deepEqual(validateBlueprint(model), model)
    model.points = model.points.filter(point => point.id !== 'inserted')
    model.settings.closed = false
    syncTrackSegments(model)
    assert.equal(model.segments.length, 2)
    assert.deepEqual(model.segments[0], kept)
    assert.deepEqual(validateBlueprint(model), model)
    model.points = []
    syncTrackSegments(model)
    assert.deepEqual(model.segments, [])
})

const malformed = [
    ['missing segments', model => { delete model.segments }],
    ['non-array segments', model => { model.segments = {} }],
    ['missing segment', model => { model.segments.pop() }],
    ['extra segment', model => { model.segments.push(structuredClone(model.segments[0])) }],
    ['null segment', model => { model.segments[0] = null }],
    ['empty id', model => { model.segments[0].id = '' }],
    ['duplicate id', model => { model.segments[1].id = model.segments[0].id }],
    ['bad start', model => { model.segments[0].from = 'missing' }],
    ['reversed endpoints', model => { model.segments[0].to = 'a' }],
    ['wrong order', model => { model.segments.reverse() }],
    ['bad shape', model => { model.segments[0].shape = 'bridge' }],
    ['missing handles', model => { delete model.segments[0].handles }],
    ['incomplete handles', model => { model.segments[0].handles = { start: { x: 1, y: 2 } } }],
    ...[NaN, Infinity, '1', 200001].map(x => [`bad handle ${x}`, model => {
        model.segments[0].handles = { start: { x, y: 0 }, end: { x: 0, y: 0 } }
    }]),
]
for (const [label, mutate] of malformed) test(`segment validation rejects ${label}`, () => {
    const model = blueprint()
    mutate(model)
    assert.throws(() => validateBlueprint(model), /Invalid blueprint:/)
})

test('SVG metadata stores segment IDs, mixed shapes, and manual handles without editing overlays', () => {
    let model = blueprint()
    model = moveTrackHandle(model, model.segments[0].id, 'end', { x: 300, y: 280 })
    model = editTrackSegment(model, model.segments[1].id, 'straight')
    const svg = exportBlueprint(model)
    const encoded = svg.match(/<metadata id="gams-track-blueprint">([^<]*)<\/metadata>/)[1]
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    const decoded = JSON.parse(encoded.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => entities[name]))
    assert.deepEqual(validateBlueprint(decoded), model)
    assert.equal(exportBlueprint(decoded), svg)
    assert.doesNotMatch(svg, /data-handle|segment-overlay|segment-highlight/)
})

test('segment operations reject invalid internal requests', () => {
    const model = blueprint()
    assert.throws(() => editTrackSegment(model, 'missing', 'curve'), /Missing segment/)
    assert.throws(() => editTrackSegment(model, model.segments[0].id, 'bridge'), /Invalid segment shape/)
    assert.throws(() => resetTrackHandles(model, 'missing'), /Missing segment/)
    assert.throws(() => moveTrackHandle(model, model.segments[0].id, 'wrong', { x: 0, y: 0 }), /Invalid curve handle/)
    const straight = editTrackSegment(model, model.segments[0].id, 'straight')
    assert.throws(() => moveTrackHandle(straight, model.segments[0].id, 'start', { x: 0, y: 0 }), /Missing curved segment/)
})

test('inserting on a straight segment keeps both resulting segments straight', () => {
    let model = blueprint()
    const id = model.segments[0].id
    model = editTrackSegment(model, id, 'straight')
    const next = insertTrackPoint(model, 0, { id: 'new', x: 250, y: 100 }, 0.5)
    assert.equal(next.segments[0].id, id)
    assert.deepEqual(next.segments.slice(0, 2).map(segment => segment.shape), ['straight', 'straight'])
    assert.deepEqual(next.segments.slice(2), model.segments.slice(1))
    assert.deepEqual(validateBlueprint(next), next)
})

test('inserting on a manual curve splits its geometry, including the closing segment', () => {
    for (const index of [0, 2]) {
        let model = blueprint()
        const id = model.segments[index].id
        model = moveTrackHandle(model, id, 'start', { x: 200, y: 320 })
        const segment = trackSegments(model)[index]
        const t = 0.375
        const point = { id: 'new', ...segmentPoint(segment, t) }
        const next = insertTrackPoint(model, index, point, t)
        const [left, right] = trackSegments(next).slice(index, index + 2)
        for (let step = 0; step <= 10; step++) {
            const u = step / 10
            for (const [actual, expected] of [[segmentPoint(left, u), segmentPoint(segment, u * t)],
                [segmentPoint(right, u), segmentPoint(segment, t + u * (1 - t))]]) {
                for (const axis of ['x', 'y']) assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-9)
            }
        }
        assert.deepEqual(validateBlueprint(next), next)
    }
})

test('handle placement follows grid snapping and document bounds', () => {
    const model = blueprint()
    model.settings.snap = true
    const id = model.segments[0].id
    const snapped = moveTrackHandle(model, id, 'start', { x: 139, y: 141 })
    assert.deepEqual(trackSegments(snapped)[0].c, { x: 120, y: 160 })
    const bounded = moveTrackHandle(model, id, 'end', { x: -20, y: 900 })
    assert.deepEqual(trackSegments(bounded)[0].d, { x: 0, y: 800 })
})

test('style assignments and reset are isolated, undoable and leave geometry unchanged', () => {
    const initial = blueprint()
    initial.styles.push({ id: 'asphalt', name: 'Asphalt', roadColor: '#123456', roadWidth: 24 })
    const id = initial.segments[0].id
    const history = new TrackHistory(initial)
    const colored = setTrackSegmentStyle(initial, id, 'asphalt')
    history.commit(colored)
    assert.equal(initial.segments[0].styleId, null)
    assert.deepEqual(colored.segments.slice(1), initial.segments.slice(1))
    assert.deepEqual(trackSegments(colored), trackSegments(initial))
    history.commit(setTrackSegmentStyle(history.model, id, null))
    assert.deepEqual(history.model, initial)
    history.undo()
    assert.equal(history.model.segments[0].styleId, 'asphalt')
    history.redo()
    assert.equal(history.model.segments[0].styleId, null)
    assert.equal(history.commit(setTrackSegmentStyle(history.model, id, null)), false)
    assert.throws(() => setTrackSegmentStyle(initial, 'missing', 'asphalt'), /Missing segment/)
    assert.throws(() => setTrackSegmentStyle(initial, id, 'red'), /Missing road style/)
})

test('segment style survives movement, shape changes, handle reset and splitting', () => {
    for (const shape of ['curve', 'straight']) {
        let model = blueprint()
        const id = model.segments[0].id
        model.styles.push({ id: 'asphalt', name: 'Asphalt', roadColor: '#123456', roadWidth: 24 })
        model = setTrackSegmentStyle(model, id, 'asphalt')
        model = editTrackSegment(model, id, shape)
        model = resetTrackHandles(model, id)
        model = moveTrackSelection(model, new Set(['a']), { x: 10, y: 10 })
        const point = { id: 'new', ...segmentPoint(trackSegments(model)[0], 0.5) }
        model = insertTrackPoint(model, 0, point, 0.5)
        assert.deepEqual(model.segments.slice(0, 2).map(segment => segment.styleId), ['asphalt', 'asphalt'])
        assert.equal(model.segments[2].styleId, null)
        syncTrackSegments(model)
        assert.deepEqual(validateBlueprint(model), model)
        assert.equal(model.segments[0].styleId, 'asphalt')
    }
})
