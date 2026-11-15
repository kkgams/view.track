import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBlueprint, syncTrackSegments, validateBlueprint, TrackHistory } from '../src/model.mjs'
import { splitTrackPoint, mergeTrackEndpoints, trackMergeTarget } from '../src/interaction.mjs'

function fixture(routes = ['abcde', 'fgh', 'ij']) {
    const model = createBlueprint()
    model.roads = routes.map((ids, i) => ({ id: `road${i}`, closed: false, pointIds: [...ids], extension: { lane: i } }))
    model.points = routes.join('').split('').map((id, i) => ({ id, x: i * 10 + 0.25, y: 20, extension: { id } }))
    model.styles = [{ id: 'style', name: 'Wide', roadWidth: 50, roadColor: '#123456' }]
    syncTrackSegments(model)
    model.segments.forEach((segment, i) => Object.assign(segment, {
        id: `edge${i}`, shape: i % 2 ? 'straight' : 'curve', styleId: i % 2 ? null : 'style',
        handles: i % 2 ? null : { start: { x: 3, y: -4 }, end: { x: -7, y: 8 }, extension: 'handles' }, extension: { i },
    }))
    return model
}
function checked(model, operation) {
    const before = structuredClone(model), next = operation(model)
    assert.deepEqual(model, before)
    assert.deepEqual(validateBlueprint(next), next)
    assert.deepEqual(next.styles, model.styles)
    return next
}
function routes(model) { return model.roads.map(road => road.pointIds.join('')) }

test('interior split makes two roads without bridging, preserving metadata and unaffected roads', () => {
    const model = fixture(), next = checked(model, m => splitTrackPoint(m, 'c'))
    assert.deepEqual(routes(next), ['ab', 'de', 'fgh', 'ij'])
    assert.deepEqual(next.roads[0], { ...model.roads[0], pointIds: ['a', 'b'] })
    assert.match(next.roads[1].id, /^[0-9a-f-]{36}$/)
    assert.notEqual(next.roads[1].id, model.roads[0].id)
    assert.deepEqual(next.roads[1].extension, model.roads[0].extension)
    assert.deepEqual(next.roads.slice(2), model.roads.slice(1))
    assert.deepEqual(next.segments, model.segments.filter(s => s.from !== 'c' && s.to !== 'c'))
    assert.deepEqual(next.points, model.points.filter(p => p.id !== 'c'))
})

test('closed split opens next-to-previous route and preserves surviving wraparound segment', () => {
    const model = fixture()
    model.roads[0].closed = true
    syncTrackSegments(model)
    const next = checked(model, m => splitTrackPoint(m, 'c'))
    assert.deepEqual(routes(next), ['deab', 'fgh', 'ij'])
    assert.deepEqual(next.roads[0], { ...model.roads[0], closed: false, pointIds: [...'deab'] })
    assert.deepEqual(next.segments, [model.segments[3], model.segments[4], model.segments[0], ...model.segments.slice(5)])
    assert.deepEqual(routes(splitTrackPoint(model, 'a')), ['bcde', 'fgh', 'ij'])
})

for (const id of ['a', 'e']) test(`split end ${id} trims without reconnecting`, () => {
    const model = fixture(), next = checked(model, m => splitTrackPoint(m, id))
    assert.deepEqual(routes(next), [id === 'a' ? 'bcde' : 'abcd', 'fgh', 'ij'])
    assert.deepEqual(next.segments, model.segments.filter(s => s.from !== id && s.to !== id))
    assert.deepEqual(next.roads[0].extension, model.roads[0].extension)
})

test('singleton split removes empty road, including closed singleton and two-point roads', () => {
    for (const closed of [false, true]) {
        const model = fixture(['a', 'bc'])
        model.roads[0].closed = closed
        const next = checked(model, m => splitTrackPoint(m, 'a'))
        assert.deepEqual(next.roads, model.roads.slice(1))
        assert.deepEqual(next.segments, model.segments)
        assert.deepEqual(routes(splitTrackPoint(next, 'b')), ['c'])
    }
})

for (const sourceId of ['a', 'c']) for (const targetId of ['d', 'f']) {
    test(`merge ${sourceId} into ${targetId} orients both routes and preserves records`, () => {
        const model = fixture(['abc', 'def', 'gh']), targetPoint = model.points.find(p => p.id === targetId)
        const next = checked(model, m => mergeTrackEndpoints(m, sourceId, targetId))
        const sourceIds = sourceId === 'a' ? 'cb' : 'ab', targetIds = targetId === 'd' ? 'def' : 'fed'
        assert.deepEqual(routes(next), [sourceIds + targetIds, 'gh'])
        assert.deepEqual(next.roads[0], { ...model.roads[1], pointIds: [...sourceIds + targetIds] })
        assert.deepEqual(next.roads[1], model.roads[2])
        assert.deepEqual(next.points, model.points.filter(p => p.id !== sourceId))
        assert.deepEqual(next.points.find(p => p.id === targetId), targetPoint)
        const expected = structuredClone(model.segments)
        for (const [start, reverse] of [[0, sourceId === 'a'], [2, targetId === 'f']]) if (reverse) {
            expected.splice(start, 2, ...expected.slice(start, start + 2).reverse().map(s => ({ ...s, from: s.to, to: s.from,
                handles: s.handles === null ? null : { ...s.handles, start: s.handles.end, end: s.handles.start } })))
        }
        expected.forEach(s => { if (s.from === sourceId) s.from = targetId; if (s.to === sourceId) s.to = targetId })
        assert.deepEqual(next.segments, expected)
    })
}

test('merging a later road into an earlier target restores canonical segment order', () => {
    const model = fixture(['abc', 'def', 'gh']), next = checked(model, m => mergeTrackEndpoints(m, 'f', 'a'))
    assert.deepEqual(routes(next), ['deabc', 'gh'])
    assert.deepEqual(next.segments.map(s => s.id), ['edge2', 'edge3', 'edge0', 'edge1', 'edge4'])
    assert.equal(next.roads[0].id, model.roads[0].id)
})

test('singleton endpoints merge without inventing segments', () => {
    for (const roads of [['a', 'bc'], ['ab', 'c'], ['a', 'b']]) {
        const model = fixture(roads), next = checked(model, m => mergeTrackEndpoints(m, 'a', roads[1][0]))
        assert.equal(next.roads.length, 1)
        assert.equal(next.segments.length, model.segments.length)
        assert.equal(trackMergeTarget(model, 'a', model.points.find(p => p.id === roads[1][0]), 0), roads[1][0])
    }
})

test('roads flagged closed with fewer than three points still have mergeable open ends', () => {
    for (const routes of [['ab', 'cd'], ['a', 'b']]) {
        const model = fixture(routes)
        model.roads.forEach(road => { road.closed = true })
        const sourceId = routes[0].at(-1), targetId = routes[1][0]
        const target = model.points.find(point => point.id === targetId)
        assert.equal(trackMergeTarget(model, sourceId, target, 0), targetId)
        const next = checked(model, value => mergeTrackEndpoints(value, sourceId, targetId))
        assert.equal(next.roads.length, 1)
        assert.equal(next.roads[0].closed, false)
        assert.deepEqual(next.roads[0].pointIds, [...routes[0].slice(0, -1), ...routes[1]])
    }
})

test('split and merge each undo and redo exactly through TrackHistory', () => {
    const history = new TrackHistory(fixture()), original = structuredClone(history.model)
    history.commit(splitTrackPoint(history.model, 'c'))
    const split = structuredClone(history.model)
    history.commit(mergeTrackEndpoints(history.model, 'b', 'd'))
    const merged = structuredClone(history.model)
    history.undo(); assert.deepEqual(history.model, split)
    history.undo(); assert.deepEqual(history.model, original)
    history.redo(); assert.deepEqual(history.model, split)
    history.redo(); assert.deepEqual(history.model, merged)
})

test('invalid IDs, same-road, interior, closed roads and malformed models fail loudly', () => {
    const model = fixture()
    for (const [source, target] of [['missing', 'f'], ['a', 'missing'], ['a', 'e'], ['c', 'f'], ['a', 'g']]) {
        assert.throws(() => mergeTrackEndpoints(model, source, target))
    }
    assert.throws(() => splitTrackPoint(model, 'missing'))
    assert.throws(() => trackMergeTarget(model, 'missing', { x: 0, y: 0 }, 10))
    model.roads[0].closed = true; syncTrackSegments(model)
    assert.throws(() => mergeTrackEndpoints(model, 'a', 'f'), /open roads/)
    assert.throws(() => mergeTrackEndpoints(model, 'f', 'a'), /open roads/)
    model.segments.pop()
    assert.throws(() => splitTrackPoint(model, 'a'), /segment count/)
    assert.throws(() => mergeTrackEndpoints(model, 'f', 'i'), /segment count/)
})

test('picking is nearest, inclusive, unsnapped and excludes same-road, interior and closed points', () => {
    const model = fixture(), before = structuredClone(model), position = { x: 60.25, y: 20 }
    assert.equal(trackMergeTarget(model, 'a', position, 9.99), null)
    assert.equal(trackMergeTarget(model, 'a', position, 10), 'f')
    assert.equal(trackMergeTarget(model, 'a', { x: 69.5, y: 20 }, 1), 'h')
    assert.equal(trackMergeTarget(model, 'a', model.points[0], 0), null)
    assert.equal(trackMergeTarget(model, 'a', model.points[5], 0), 'f')
    assert.equal(trackMergeTarget(model, 'c', position, 100), null)
    assert.deepEqual(model, before)
    model.roads[1].closed = true; syncTrackSegments(model)
    assert.equal(trackMergeTarget(model, 'a', position, 100), 'i')
    assert.equal(trackMergeTarget(model, 'f', position, 100), null)
    for (const tolerance of [-1, NaN, Infinity]) assert.throws(() => trackMergeTarget(model, 'a', position, tolerance))
    assert.throws(() => trackMergeTarget(model, 'a', { x: NaN, y: 0 }, 10))
})
