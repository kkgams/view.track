import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BLUEPRINT_FORMAT, createBlueprint, validateBlueprint, TrackHistory, placePoint, syncTrackSegments } from '../src/model.mjs'

test('new blueprints have independent nested state and validate without aliasing', () => {
    const first = createBlueprint(), second = createBlueprint()
    assert.equal(first.format, BLUEPRINT_FORMAT)
    assert.equal(first.version, 2)
    assert.deepEqual(first.roads, [])
    assert.equal(Object.hasOwn(first.settings, 'closed'), false)
    const checked = validateBlueprint(first)
    checked.settings.snap = false
    checked.points.push({ id: 'p', x: 1, y: 2 })
    checked.roads.push({ id: 'road-1', closed: false, pointIds: ['p'] })
    first.annotations.push({ text: 'note' })
    assert.equal(first.settings.snap, true)
    assert.deepEqual(first.points, [])
    assert.deepEqual(first.roads, [])
    assert.deepEqual(second.roads, [])
    assert.deepEqual(second.annotations, [])
    assert.deepEqual(checked.annotations, [])
})

const invalid = [
    ['format', value => { value.format = 'svg' }],
    ['version', value => { value.version = 3 }],
    ['name type', value => { value.name = 42 }],
    ['name length', value => { value.name = 'x'.repeat(1001) }],
    ['missing viewport', value => { delete value.viewport }],
    ['small viewport', value => { value.viewport.width = 99 }],
    ['large viewport', value => { value.viewport.height = 10001 }],
    ['nonfinite viewport', value => { value.viewport.width = Infinity }],
    ['numeric string viewport', value => { value.viewport.width = '1200' }],
    ['missing settings', value => { delete value.settings }],
    ['nonboolean closed', value => {
        value.points = [{ id: 'p', x: 0, y: 0 }]
        value.roads = [{ id: 'road-1', closed: 1, pointIds: ['p'] }]
    }],
    ...['snap', 'grid'].map(key => [`nonboolean ${key}`, value => { value.settings[key] = 1 }]),
    ...[4, 201, NaN, Infinity, '40'].map(size => [`grid size ${size}`, value => { value.settings.gridSize = size }]),
    ['points type', value => { value.points = {} }],
    ['point limit', value => {
        value.points = Array.from({ length: 10001 }, (_, id) => ({ id: String(id), x: 0, y: 0 }))
        value.roads = [{ id: 'road-1', closed: false, pointIds: value.points.map(point => point.id) }]
    }],
    ['null point', value => {
        value.points = [null]
        value.roads = [{ id: 'road-1', closed: false, pointIds: ['p'] }]
    }],
    ['empty ID', value => {
        value.points = [{ id: '', x: 0, y: 0 }]
        value.roads = [{ id: 'road-1', closed: false, pointIds: [''] }]
    }],
    ['numeric ID', value => {
        value.points = [{ id: 1, x: 0, y: 0 }]
        value.roads = [{ id: 'road-1', closed: false, pointIds: [1] }]
    }],
    ['duplicate ID', value => {
        value.points = [{ id: 'p', x: 0, y: 0 }, { id: 'p', x: 1, y: 1 }]
        value.roads = [{ id: 'road-1', closed: false, pointIds: ['p', 'p'] }]
    }],
    ...[NaN, Infinity, -Infinity, 100001, -100001, '0'].map(x => [`coordinate ${x}`, value => {
        value.points = [{ id: 'p', x, y: 0 }]
        value.roads = [{ id: 'road-1', closed: false, pointIds: ['p'] }]
    }]),
    ['annotations type', value => { value.annotations = null }],
]
for (const [name, mutate] of invalid) test(`validation rejects ${name}`, () => {
    const value = createBlueprint()
    mutate(value)
    assert.throws(() => validateBlueprint(value), /Invalid blueprint:/)
})
test('validation rejects absent/nonmodel input', () => {
    for (const value of [null, undefined, false, 0, '', [], {}]) assert.throws(() => validateBlueprint(value), /Invalid blueprint:/)
})
test('validation accepts documented numeric limits, fractional grid and coordinates outside viewport', () => {
    const value = createBlueprint()
    value.name = 'x'.repeat(1000)
    value.viewport = { width: 100, height: 10000 }
    value.settings.gridSize = 5
    value.points = Array.from({ length: 10000 }, (_, id) => ({ id: String(id), x: -100000, y: 100000 }))
    value.roads = [{ id: 'road-1', closed: true, pointIds: value.points.map(point => point.id) }]
    syncTrackSegments(value)
    assert.deepEqual(validateBlueprint(value), value)
    value.settings.gridSize = 200
    assert.equal(validateBlueprint(value).settings.gridSize, 200)
    value.settings.gridSize = 5.5
    assert.equal(validateBlueprint(value).settings.gridSize, 5.5)
})
test('validation preserves JSON extension fields and annotations with deep isolation', () => {
    const value = createBlueprint()
    value.extension = { unknown: ['future'] }
    value.viewport.units = 'metres'
    value.settings.extension = { revision: 2 }
    value.points = [{ id: 'p', x: 0, y: 0, extension: { speed: 3 } }]
    value.roads = [{ id: 'road-1', closed: false, pointIds: ['p'] }]
    value.annotations = [{ kind: 'future', nested: { text: '<note>' } }]
    const checked = validateBlueprint(value)
    assert.deepEqual(checked, value)
    checked.extension.unknown.push('edit')
    checked.points[0].extension.speed = 9
    checked.annotations[0].nested.text = 'edit'
    assert.deepEqual(value.extension.unknown, ['future'])
    assert.equal(value.points[0].extension.speed, 3)
    assert.equal(value.annotations[0].nested.text, '<note>')
})
test('snapping rounds to the nearest grid point and clamps to viewport', () => {
    const value = createBlueprint()
    assert.deepEqual(placePoint(value, 19, 20), { x: 0, y: 40 })
    assert.deepEqual(placePoint(value, 61, 79), { x: 80, y: 80 })
    assert.deepEqual(placePoint(value, -50, 9999), { x: 0, y: 800 })
    value.viewport.width = 1190
    assert.deepEqual(placePoint(value, 1199, -1), { x: 1190, y: 0 })
})
test('unsnapped placement preserves fractional values and still clamps', () => {
    const value = createBlueprint()
    value.settings.snap = false
    assert.deepEqual(placePoint(value, 21.25, 99.5), { x: 21.25, y: 99.5 })
    assert.deepEqual(placePoint(value, -1, 1000), { x: 0, y: 800 })
})
test('history clones initial and committed inputs and preserves extension data across undo/redo', () => {
    const initial = createBlueprint()
    initial.extension = { values: [1] }
    const history = new TrackHistory(initial)
    initial.extension.values[0] = 99
    const next = structuredClone(history.model)
    next.name = 'Changed'
    next.points.push({ id: 'p', x: 2, y: 3, extension: { flag: true } })
    next.roads.push({ id: 'road-1', closed: false, pointIds: ['p'] })
    next.annotations.push({ text: 'retained' })
    assert.equal(history.commit(next), true)
    next.points[0].extension.flag = false
    assert.equal(history.undo(), true)
    assert.equal(history.model.name, 'Untitled track')
    assert.deepEqual(history.model.extension, { values: [1] })
    assert.equal(history.redo(), true)
    assert.equal(history.model.points[0].extension.flag, true)
    assert.deepEqual(history.model.annotations, [{ text: 'retained' }])
    assert.equal(history.redo(), false)
})
test('history no-op preserves redo, changed commit discards it, and invalid commit is atomic', () => {
    const history = new TrackHistory()
    assert.equal(history.undo(), false)
    assert.equal(history.redo(), false)
    history.commit({ ...history.model, name: 'Second' })
    history.undo()
    assert.equal(history.commit(structuredClone(history.model)), false)
    assert.equal(history.future.length, 1)
    const snapshot = structuredClone(history)
    assert.throws(() => history.commit({ ...history.model, version: 3 }), /Invalid blueprint:/)
    assert.deepEqual(structuredClone(history), snapshot)
    assert.equal(history.commit({ ...history.model, name: 'Branch' }), true)
    assert.equal(history.future.length, 0)
    assert.equal(history.redo(), false)
})
test('history retains the latest 100 transitions', () => {
    const history = new TrackHistory()
    for (let index = 1; index <= 105; index++) history.commit({ ...history.model, name: String(index) })
    assert.equal(history.past.length, 100)
    for (let index = 0; index < 100; index++) assert.equal(history.undo(), true)
    assert.equal(history.model.name, '5')
    assert.equal(history.undo(), false)
    for (let index = 0; index < 100; index++) assert.equal(history.redo(), true)
    assert.equal(history.model.name, '105')
    assert.equal(history.redo(), false)
})

test('undo and redo across opened files restore the corresponding save destination', () => {
    const a = { path: 'a.svg', saved: 'a baseline' }
    const b = { path: 'b.svg', saved: 'b baseline' }
    const history = new TrackHistory(createBlueprint(), a)
    history.commit({ ...history.model, name: 'A edit' })
    history.commit({ ...history.model, name: 'B' }, b)
    history.undo()
    assert.equal(history.context, a)
    assert.equal(history.model.name, 'A edit')
    history.redo()
    assert.equal(history.context, b)
    assert.equal(history.model.name, 'B')
    history.context.path = 'b-copy.svg'
    history.commit({ ...history.model, name: 'B edit' })
    history.undo()
    assert.equal(history.context.path, 'b-copy.svg')
})
