import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as model from '../src/model.mjs'
import * as geometry from '../src/geometry.mjs'
import * as interaction from '../src/interaction.mjs'

// Unit-test controller transitions without mounting a DOM or substituting Host APIs.
// Rendering and coordinate transforms are separate browser concerns.
let ViewTrack
const source = readFileSync(new URL('../src/views/view-track.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replace('export class ViewTrack', 'class ViewTrack')
vm.runInNewContext(source, {
    ...model, ...geometry, ...interaction, structuredClone, crypto,
    HTMLElement: class {}, customElements: { define: (_, constructor) => { ViewTrack = constructor } },
})

function editor() {
    const value = model.createBlueprint()
    value.settings.snap = false
    value.points = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 500, y: 100 }, { id: 'c', x: 500, y: 500 }]
    value.roads.push({ id: 'road-1', closed: false, pointIds: value.points.map(point => point.id) })
    model.syncTrackSegments(value)
    const view = Object.create(ViewTrack.prototype)
    Object.assign(view, {
        history: new model.TrackHistory(value, { path: '', saved: JSON.stringify(value) }),
        selected: new Set(), selectedSegment: null, selectedStyle: null, drag: null, busy: false, preview: false,
        tool: 'select', spacePressed: false, renders: 0, styleWidth: { value: '24' },
        render() { this.renders++ }, screenScale() { return 1 },
        canvasPoint(event) { return { x: event.clientX, y: event.clientY } },
    })
    let captured = null
    view.svg = {
        focus() {}, setPointerCapture(id) { captured = id },
        hasPointerCapture(id) { return captured === id }, releasePointerCapture() { captured = null },
    }
    return view
}
function pointer(x, y, attributes = {}, extra = {}) {
    return { button: 0, pointerId: 1, clientX: x, clientY: y, shiftKey: false,
        preventDefault() {}, target: { getAttribute(name) { return attributes[name] ?? null } }, ...extra }
}

test('Select clicks a road segment without adding points or entering history', () => {
    const view = editor()
    const before = structuredClone(view.history.model)
    const midpoint = geometry.segmentPoint(geometry.trackSegments(before)[0], 0.5)
    view.pointerDown(pointer(midpoint.x, midpoint.y))
    assert.equal(view.selectedSegment, before.segments[0].id)
    assert.equal(view.selected.size, 0)
    assert.equal(view.drag, null)
    assert.deepEqual(view.history.model, before)
    assert.equal(view.history.past.length, 0)
})

test('a handle drag commits once on release; cancel restores geometry and segment selection', () => {
    const view = editor()
    const before = structuredClone(view.history.model)
    view.selectedSegment = before.segments[0].id
    const control = geometry.trackSegments(before)[0].c
    view.pointerDown(pointer(control.x, control.y, { 'data-handle': 'start' }))
    view.pointerMove(pointer(200, 250))
    view.pointerMove(pointer(220, 270))
    assert.deepEqual(view.history.model, before)
    assert.equal(view.history.past.length, 0)
    assert.deepEqual(geometry.trackSegments(view.drag.draft)[0].c, { x: 220, y: 270 })
    view.pointerUp(pointer(220, 270))
    assert.equal(view.history.past.length, 1)
    assert.equal(view.drag, null)
    view.undo()
    assert.deepEqual(view.history.model, before)
    view.pointerDown(pointer(control.x, control.y, { 'data-handle': 'start' }))
    view.pointerMove(pointer(220, 270))
    view.pointerCancel(pointer(220, 270))
    assert.deepEqual(view.history.model, before)
    assert.equal(view.selectedSegment, before.segments[0].id)
    assert.equal(view.drag, null)
})

test('clicking a handle without moving is not an edit', () => {
    const view = editor()
    view.selectedSegment = view.history.model.segments[0].id
    const c = geometry.trackSegments(view.history.model)[0].c
    view.pointerDown(pointer(c.x, c.y, { 'data-handle': 'start' }))
    view.pointerUp(pointer(c.x, c.y))
    assert.equal(view.history.past.length, 0)
    assert.equal(view.history.model.segments[0].handles, null)
})

test('inspector shape changes and handle reset share undo history', () => {
    const view = editor()
    const id = view.history.model.segments[0].id
    view.history.commit(interaction.moveTrackHandle(view.history.model, id, 'start', { x: 200, y: 250 }))
    view.selectedSegment = id
    view.segmentShape = { value: 'straight' }
    view.changeSegment(false)
    assert.equal(view.history.model.segments[0].shape, 'straight')
    view.segmentShape.value = 'curve'
    view.changeSegment(false)
    view.changeSegment(true)
    assert.equal(view.history.model.segments[0].handles, null)
    view.undo()
    assert.notEqual(view.history.model.segments[0].handles, null)
})

test('preview and busy operations prevent canvas and inspector edits', () => {
    for (const state of ['preview', 'busy']) {
        const view = editor()
        const before = structuredClone(view.history.model)
        view.selectedSegment = before.segments[0].id
        view.segmentShape = { value: 'straight' }
        view[state] = true
        view.changeSegment(false)
        view.changeHandle({})
        view.pointerDown(pointer(200, 200, { 'data-handle': 'start' }))
        assert.deepEqual(view.history.model, before)
        assert.equal(view.drag, null)
    }
})

test('Add point splits a straight segment without turning it into curves', () => {
    const view = editor()
    const id = view.history.model.segments[0].id
    view.history.commit(interaction.editTrackSegment(view.history.model, id, 'straight'))
    view.tool = 'draw'
    view.pointerDown(pointer(300, 100))
    assert.equal(view.history.model.points.length, 4)
    assert.deepEqual(view.history.model.segments.slice(0, 2).map(segment => segment.shape), ['straight', 'straight'])
    assert.deepEqual(model.validateBlueprint(view.history.model), view.history.model)
})

test('segment style inspector assigns and resets, including in preview', () => {
    const view = editor()
    view.history.model.styles.push({ id: 'asphalt', name: 'Asphalt', roadColor: '#AbCdEf', roadWidth: 24 })
    view.selectedSegment = view.history.model.segments[0].id
    view.segmentStyle = { value: 'asphalt' }
    view.changeSegmentStyle()
    assert.equal(view.history.model.segments[0].styleId, 'asphalt')
    view.preview = true
    view.segmentStyle.value = ''
    view.changeSegmentStyle()
    assert.equal(view.history.model.segments[0].styleId, null)
    view.undo()
    assert.equal(view.history.model.segments[0].styleId, 'asphalt')
    view.busy = true
    view.changeSegmentStyle()
    assert.equal(view.history.model.segments[0].styleId, 'asphalt')
})

test('style table edits shared definitions and rejects invalid input atomically', () => {
    const view = editor()
    view.history.model.styles.push({ id: 'asphalt', name: 'Asphalt', roadColor: '#123456', roadWidth: 24 })
    let reports = 0
    const name = { value: 'Dirt', setCustomValidity() {}, reportValidity() { reports++ } }
    const color = { value: '#aa3300', setCustomValidity() {}, reportValidity() { reports++ } }
    view.selectedStyle = 'asphalt'
    view.styleName = name
    view.styleColor = color
    view.changeStyle(name)
    assert.equal(view.history.model.styles[0].name, 'Dirt')
    assert.equal(view.history.model.styles[0].roadColor, '#aa3300')
    color.value = 'red'
    view.changeStyle(color)
    assert.equal(reports, 1)
    assert.equal(view.history.past.length, 1)
    assert.equal(view.history.model.styles[0].roadColor, '#aa3300')
    view.deleteStyle('asphalt')
    assert.deepEqual(view.history.model.styles, [])
    view.undo()
    assert.equal(view.history.model.styles[0].name, 'Dirt')
})

test('style row selection is session-only and busy guards preserve selection', () => {
    const view = editor()
    view.history.model.styles = [{ id: 'asphalt', name: 'Asphalt', roadColor: '#123456', roadWidth: 24 }, { id: 'dirt', name: 'Dirt', roadColor: '#aa3300', roadWidth: 24 }]
    const before = structuredClone(view.history.model)
    let focused = null
    view.styleEditors = new Map(view.history.model.styles.map(style => [style.id, { row: { focus() { focused = style.id } } }]))
    view.selectStyle('dirt', true)
    assert.equal(view.selectedStyle, 'dirt')
    assert.equal(focused, 'dirt')
    assert.deepEqual(view.history.model, before)
    assert.equal(view.history.past.length, 0)
    view.busy = true
    view.selectStyle('asphalt', true)
    assert.equal(view.selectedStyle, 'dirt')
    view.busy = false
    assert.throws(() => view.selectStyle('missing'), /Missing road style/)
})

test('style rows support arrow, Home/End and activation keys without intercepting delete buttons', () => {
    const view = editor()
    view.history.model.styles = [{ id: 'asphalt', name: 'Asphalt', roadColor: '#123456', roadWidth: 24 }, { id: 'dirt', name: 'Dirt', roadColor: '#aa3300', roadWidth: 24 }]
    view.styleEditors = new Map(view.history.model.styles.map(style => [style.id, { row: { focus() {} } }]))
    const press = (id, key, button = false) => {
        let handled = false
        view.styleKeyDown({ key, preventDefault() { handled = true }, stopPropagation() {},
            target: { closest(selector) { return selector === 'button' ? button : { dataset: { styleId: id } } } } })
        return handled
    }
    assert.equal(press('asphalt', 'ArrowDown'), true)
    assert.equal(view.selectedStyle, 'dirt')
    press('dirt', 'Home')
    assert.equal(view.selectedStyle, 'asphalt')
    press('asphalt', 'End')
    assert.equal(view.selectedStyle, 'dirt')
    press('dirt', 'ArrowDown')
    assert.equal(view.selectedStyle, 'dirt')
    press('dirt', 'ArrowUp')
    assert.equal(view.selectedStyle, 'asphalt')
    press('dirt', 'Enter')
    assert.equal(view.selectedStyle, 'dirt')
    press('asphalt', ' ')
    assert.equal(view.selectedStyle, 'asphalt')
    assert.equal(press('dirt', 'Enter', true), false)
    assert.equal(view.selectedStyle, 'asphalt')
    assert.equal(press('dirt', 'x'), false)
    assert.equal(view.history.past.length, 0)
})

test('adding a style focuses and selects its name; deleting selects the next row', () => {
    const view = editor()
    const actions = []
    view.styleName = { focus() { actions.push('focus') }, select() { actions.push('select') } }
    view.addStyle()
    assert.equal(view.selectedStyle, view.history.model.styles[0].id)
    assert.deepEqual(actions, ['focus', 'select'])
    const first = view.selectedStyle
    view.addStyle()
    const second = view.selectedStyle
    assert.deepEqual(actions, ['focus', 'select', 'focus', 'select'])
    assert.notEqual(first, second)
    view.deleteStyle(second)
    assert.equal(view.selectedStyle, first)
    view.deleteStyle(first)
    assert.equal(view.selectedStyle, null)
})

test('properties do not edit without selection or while busy', () => {
    const view = editor()
    view.styleName = { value: 'Dirt' }
    view.styleColor = { value: '#aa3300' }
    view.changeStyle(view.styleColor)
    assert.equal(view.history.past.length, 0)
    view.busy = true
    view.selectedStyle = 'missing'
    view.changeStyle(view.styleColor)
    assert.equal(view.history.past.length, 0)
})

test('style width property edits are undoable and invalid widths leave the model untouched', () => {
    const view = editor()
    view.history.model.styles = [{ id: 'wide', name: 'Wide road', roadColor: '#123456', roadWidth: 24 }]
    view.selectedStyle = 'wide'
    view.styleName = { value: 'Wide road' }
    view.styleColor = { value: '#123456' }
    let reports = 0
    view.styleWidth = { value: '80', setCustomValidity() {}, reportValidity() { reports++ } }
    view.changeStyle(view.styleWidth)
    assert.equal(view.history.model.styles[0].roadWidth, 80)
    assert.equal(view.history.past.length, 1)
    view.styleWidth.value = '0'
    view.changeStyle(view.styleWidth)
    assert.equal(reports, 1)
    assert.equal(view.history.model.styles[0].roadWidth, 80)
    view.styleWidth.value = ''
    view.changeStyle(view.styleWidth)
    assert.equal(reports, 2)
    assert.equal(view.history.past.length, 1)
    view.undo()
    assert.equal(view.history.model.styles[0].roadWidth, 24)
})

test('Fit track includes the widest assigned style with shoulders and outline', () => {
    const view = editor()
    view.history.model.styles = [{ id: 'wide', name: 'Wide road', roadColor: '#123456', roadWidth: 200 }]
    view.history.model.segments[0].styleId = 'wide'
    const model = view.history.model
    const bounds = [...model.points, ...geometry.trackSegments(model).flatMap(segment => [segment.c, segment.d])]
    const padding = 40 + 100 + model.rendering.edgeWidth + model.rendering.outlineWidth
    view.zoomFit()
    for (const point of bounds) {
        assert.ok(view.camera.x <= point.x - padding + 1e-9)
        assert.ok(view.camera.y <= point.y - padding + 1e-9)
        assert.ok(view.camera.x + view.camera.width >= point.x + padding - 1e-9)
        assert.ok(view.camera.y + view.camera.height >= point.y + padding - 1e-9)
    }
})

test('new tracks remain open while Add point extends outside the road', () => {
    assert.deepEqual(model.createBlueprint().roads, [])
    const view = editor()
    view.tool = 'draw'
    view.selected = new Set(['c'])
    view.pointerDown(pointer(800, 600))
    const next = view.history.model
    assert.equal(next.roads[0].closed, false)
    assert.deepEqual(next.points.at(-1), { id: next.points.at(-1).id, x: 800, y: 600 })
    assert.equal(next.segments.length, 3)
    assert.equal(next.segments.at(-1).to, next.points.at(-1).id)
    assert.doesNotMatch(geometry.trackPath(next), / Z$/)
    assert.equal(view.history.past.length, 1)
    view.undo()
    assert.equal(view.history.model.points.length, 3)
})

test('drawing from a selected point inserts after it and continues from each new point', () => {
    for (const closed of [false, true]) {
        const view = editor()
        view.tool = 'draw'
        view.history.model.roads[0].closed = closed
        model.syncTrackSegments(view.history.model)
        const before = structuredClone(view.history.model)
        view.pointerDown(pointer(500, 100, { 'data-id': 'b' }))
        view.pointerUp(pointer(500, 100, { 'data-id': 'b' }))
        assert.deepEqual([...view.selected], ['b'])
        view.pointerDown(pointer(800, 600))
        const first = view.history.model.points[2]
        assert.equal(first.x, 800)
        assert.equal(first.y, 600)
        assert.deepEqual(view.history.model.points.map(point => point.id), ['a', 'b', first.id, 'c'])
        assert.deepEqual([...view.selected], [first.id])
        view.pointerDown(pointer(1000, 700))
        const second = view.history.model.points[3]
        assert.deepEqual(view.history.model.points.map(point => point.id), ['a', 'b', first.id, second.id, 'c'])
        assert.deepEqual([...view.selected], [second.id])
        assert.equal(view.history.model.roads[0].closed, closed)
        assert.deepEqual(model.validateBlueprint(view.history.model), view.history.model)
        assert.deepEqual(view.history.model.segments[0], before.segments[0])
        const drawn = structuredClone(view.history.model)
        view.undo()
        view.undo()
        assert.deepEqual(view.history.model, before)
        view.redo()
        view.redo()
        assert.deepEqual(view.history.model, drawn)
    }
})

test('drawing from the first point inserts before its successor; last point still appends', () => {
    for (const selected of ['a', 'c']) {
        const view = editor()
        view.tool = 'draw'
        view.selected = new Set([selected])
        view.pointerDown(pointer(800, 600))
        const ids = view.history.model.points.map(point => point.id)
        const added = [...view.selected][0]
        assert.deepEqual(ids, selected === 'a' ? ['a', added, 'b', 'c'] : ['a', 'b', 'c', added])
    }
})

test('multiple selected points have no unique drawing origin and do not create off-road points', () => {
    const view = editor()
    view.tool = 'draw'
    view.selected = new Set(['a', 'b'])
    const before = structuredClone(view.history.model)
    view.pointerDown(pointer(800, 600))
    assert.deepEqual(view.history.model, before)
    assert.equal(view.history.past.length, 0)
})

test('clicking the road splits the clicked segment regardless of the selected drawing origin', () => {
    const view = editor()
    view.tool = 'draw'
    view.selected = new Set(['c'])
    view.history.model.segments[0].shape = 'straight'
    view.pointerDown(pointer(300, 100))
    assert.deepEqual(view.history.model.points.map(point => point.id), ['a', [...view.selected][0], 'b', 'c'])
    assert.deepEqual(model.validateBlueprint(view.history.model), view.history.model)
})

test('Add point picks the visible wide road, not a fixed screen-distance threshold', () => {
    const view = editor()
    view.tool = 'draw'
    view.history.model.rendering.roadWidth = 200
    view.history.model.segments[0].shape = 'straight'
    view.pointerDown(pointer(300, 180))
    assert.equal(view.history.model.points.length, 4)
    assert.equal(view.history.model.points[1].x, 300)
    assert.equal(view.history.model.points[1].y, 100)
    assert.deepEqual(view.history.model.segments.slice(0, 2).map(segment => segment.shape), ['straight', 'straight'])
})

test('connecting and reopening ends is undoable and preserves existing segment records', () => {
    const view = editor()
    const before = structuredClone(view.history.model)
    view.toggleLoop()
    assert.equal(view.history.model.roads[0].closed, true)
    assert.equal(view.history.model.segments.length, 3)
    assert.deepEqual(view.history.model.segments.slice(0, 2), before.segments)
    assert.equal(view.history.model.segments.at(-1).from, 'c')
    assert.equal(view.history.model.segments.at(-1).to, 'a')
    assert.match(geometry.trackPath(view.history.model), / Z$/)
    const loop = structuredClone(view.history.model)
    view.toggleLoop()
    assert.deepEqual(view.history.model, before)
    view.undo()
    assert.deepEqual(view.history.model, loop)
    view.undo()
    assert.deepEqual(view.history.model, before)
    view.redo()
    assert.deepEqual(view.history.model, loop)
})

test('Add point connects opposite endpoints without duplicating a point', () => {
    for (const [selected, clicked] of [['c', 'a'], ['a', 'c']]) {
        const view = editor()
        view.tool = 'draw'
        view.selected = new Set([selected])
        const point = view.history.model.points.find(point => point.id === clicked)
        view.pointerDown(pointer(point.x, point.y, { 'data-id': clicked }))
        assert.equal(view.history.model.roads[0].closed, true)
        assert.equal(view.history.model.points.length, 3)
        assert.equal(view.history.past.length, 1)
        assert.equal(view.drag, null)
    }
})

test('loop action refuses incomplete tracks and edits during preview or file operations', () => {
    for (const state of ['short', 'preview', 'busy']) {
        const view = editor()
        if (state === 'short') {
            view.history.model = interaction.deleteTrackPoints(view.history.model, new Set(['c']))
        } else view[state] = true
        const before = structuredClone(view.history.model)
        view.toggleLoop()
        assert.deepEqual(view.history.model, before)
        assert.equal(view.history.past.length, 0)
    }
})

test('Space + left-drag pans without editing or changing the active tool', () => {
    const view = editor()
    view.tool = 'draw'
    view.camera = { x: 0, y: 0, width: 1200, height: 800 }
    const before = structuredClone(view.history.model)
    view.keyDown({ key: ' ', preventDefault() {} })
    view.pointerDown(pointer(100, 100))
    assert.equal(view.drag.kind, 'pan')
    view.pointerMove(pointer(150, 170))
    assert.deepEqual({ ...view.camera }, { x: -50, y: -70, width: 1200, height: 800 })
    view.keyUp({ key: ' ', preventDefault() {} })
    assert.equal(view.drag, null)
    assert.equal(view.tool, 'draw')
    assert.deepEqual(view.history.model, before)
    assert.equal(view.history.past.length, 0)
    assert.throws(() => view.setTool('pan'), /Unknown track tool/)
    assert.throws(() => view.setTool('insert'), /Unknown track tool/)
})

function drawSecondRoad(view) {
    view.tool = 'draw'
    view.keyDown({ key: 'Escape' })
    view.pointerDown(pointer(800, 600))
    view.pointerDown(pointer(1000, 700))
    view.pointerDown(pointer(1100, 400))
    return view.history.model.roads[1]
}

test('the first drawing click creates one open road and one selected point', () => {
    const view = editor()
    view.history = new model.TrackHistory(model.createBlueprint())
    view.tool = 'draw'
    view.pointerDown(pointer(200, 200))
    const value = view.history.model
    assert.equal(value.roads.length, 1)
    assert.equal(value.points.length, 1)
    assert.deepEqual(value.roads[0].pointIds, [value.points[0].id])
    assert.equal(value.roads[0].closed, false)
    assert.deepEqual(value.segments, [])
    assert.deepEqual([...view.selected], [value.points[0].id])
    assert.deepEqual(model.validateBlueprint(value), value)
})

test('deselecting starts a disconnected road and subsequent clicks continue only that road', () => {
    const view = editor()
    const before = structuredClone(view.history.model)
    const geometryBefore = geometry.trackSegments(before)
    const road = drawSecondRoad(view)
    assert.equal(view.history.model.roads.length, 2)
    assert.equal(road.closed, false)
    assert.equal(road.pointIds.length, 3)
    assert.deepEqual(view.history.model.roads[0], before.roads[0])
    assert.deepEqual(view.history.model.segments.slice(0, 2), before.segments)
    assert.deepEqual(geometry.trackSegments(view.history.model).slice(0, 2), geometryBefore)
    assert.equal(view.history.model.segments.length, 4)
    assert.deepEqual(view.history.model.segments.slice(2).map(segment => [segment.from, segment.to]),
        [[road.pointIds[0], road.pointIds[1]], [road.pointIds[1], road.pointIds[2]]])
    assert.deepEqual([...view.selected], [road.pointIds[2]])
    const drawn = structuredClone(view.history.model)
    for (let step = 0; step < 3; step++) view.undo()
    assert.deepEqual(view.history.model, before)
    for (let step = 0; step < 3; step++) view.redo()
    assert.deepEqual(view.history.model, drawn)
})

test('selecting an earlier road resumes it without changing the newer road', () => {
    const view = editor()
    const second = structuredClone(drawSecondRoad(view))
    const segmentsBefore = structuredClone(view.history.model.segments.slice(2))
    view.pointerDown(pointer(500, 100, { 'data-id': 'b' }))
    view.pointerUp(pointer(500, 100, { 'data-id': 'b' }))
    view.pointerDown(pointer(200, 700))
    const added = [...view.selected][0]
    assert.deepEqual(view.history.model.roads[0].pointIds, ['a', 'b', added, 'c'])
    assert.deepEqual(view.history.model.roads[1], second)
    assert.deepEqual(view.history.model.segments.slice(3), segmentsBefore)
})

test('connect/open applies only to one selected road and never joins different roads', () => {
    const view = editor()
    const second = drawSecondRoad(view)
    view.pointerDown(pointer(800, 600, { 'data-id': second.pointIds[0] }))
    assert.equal(view.history.model.roads[1].closed, true)
    assert.equal(view.history.model.roads[0].closed, false)
    view.selected = new Set(['b'])
    view.toggleLoop()
    assert.equal(view.history.model.roads[0].closed, true)
    assert.equal(view.history.model.roads[1].closed, true)
    view.selected = new Set([second.pointIds[1]])
    view.toggleLoop()
    assert.equal(view.history.model.roads[1].closed, false)
    assert.equal(view.history.model.roads[0].closed, true)
    view.selected.clear()
    const before = structuredClone(view.history.model)
    view.toggleLoop()
    assert.deepEqual(view.history.model, before)
    view.selected = new Set(['a', second.pointIds[0]])
    view.toggleLoop()
    assert.deepEqual(view.history.model, before)
    view.selected.clear()
    view.selectedSegment = view.history.model.segments.at(-1).id
    view.toggleLoop()
    assert.equal(view.history.model.roads[1].closed, true)
})

test('deleting points removes empty roads without connecting their neighbors and is undoable', () => {
    const view = editor()
    const second = drawSecondRoad(view)
    const before = structuredClone(view.history.model)
    view.selected = new Set(second.pointIds)
    view.deleteSelected()
    assert.equal(view.history.model.roads.length, 1)
    assert.deepEqual(view.history.model.roads[0], before.roads[0])
    assert.deepEqual(view.history.model.segments, before.segments.slice(0, 2))
    view.undo()
    assert.deepEqual(view.history.model, before)
    view.selected = new Set(view.history.model.points.map(point => point.id))
    view.deleteSelected()
    assert.deepEqual(view.history.model.roads, [])
    assert.deepEqual(view.history.model.points, [])
    assert.deepEqual(view.history.model.segments, [])
})

test('on-road insertion in a later road uses segment ownership, not its global index as a point index', () => {
    const view = editor()
    const second = drawSecondRoad(view)
    const before = structuredClone(view.history.model)
    const index = 2
    const segment = geometry.trackSegments(before)[index]
    const point = geometry.segmentPoint(segment, 0.5)
    view.selected.clear()
    view.pointerDown(pointer(point.x, point.y))
    const added = [...view.selected][0]
    assert.deepEqual(view.history.model.roads[1].pointIds, [second.pointIds[0], added, ...second.pointIds.slice(1)])
    assert.deepEqual(view.history.model.roads[0], before.roads[0])
    assert.deepEqual(view.history.model.segments.slice(0, 2), before.segments.slice(0, 2))
    assert.equal(view.history.model.roads.length, 2)
    assert.deepEqual(model.validateBlueprint(view.history.model), view.history.model)
})

test('point operations fail loudly for a missing drawing origin or segment', () => {
    const value = editor().history.model
    assert.throws(() => interaction.addTrackPoint(value, { id: 'new', x: 800, y: 600 }, 'missing'), /Missing drawing origin/)
    assert.throws(() => interaction.insertTrackPoint(value, 100, { id: 'new', x: 300, y: 100 }, 0.5), /Invalid segment insertion/)
})

test('Split removes the selected point and disconnects its two sides in one undo step', () => {
    const view = editor()
    view.selected = new Set(['b'])
    const before = structuredClone(view.history.model)
    view.splitSelected()
    assert.deepEqual(view.history.model.points.map(point => point.id), ['a', 'c'])
    assert.deepEqual(view.history.model.roads.map(road => road.pointIds), [['a'], ['c']])
    assert.deepEqual(view.history.model.segments, [])
    assert.equal(view.selected.size, 0)
    assert.equal(view.selectedSegment, null)
    assert.equal(view.history.past.length, 1)
    const split = structuredClone(view.history.model)
    view.undo()
    assert.deepEqual(view.history.model, before)
    view.redo()
    assert.deepEqual(view.history.model, split)
})

test('Split opens a loop at the removed point without joining the new endpoints', () => {
    const view = editor()
    view.history.model.roads[0].closed = true
    model.syncTrackSegments(view.history.model)
    const closing = structuredClone(view.history.model.segments[2])
    view.selected = new Set(['b'])
    view.splitSelected()
    assert.equal(view.history.model.roads.length, 1)
    assert.equal(view.history.model.roads[0].closed, false)
    assert.deepEqual(view.history.model.roads[0].pointIds, ['c', 'a'])
    assert.deepEqual(view.history.model.segments, [closing])
})

test('Split requires one point and refuses preview or busy edits', () => {
    for (const state of ['none', 'multiple', 'preview', 'busy']) {
        const view = editor()
        view.selected = new Set(state === 'none' ? [] : state === 'multiple' ? ['a', 'b'] : ['b'])
        if (state === 'preview' || state === 'busy') view[state] = true
        const before = structuredClone(view.history.model)
        view.splitSelected()
        assert.deepEqual(view.history.model, before)
        assert.equal(view.history.past.length, 0)
    }
})

test('endpoint drag previews a merge and commits one joined road with a single surviving point', () => {
    const view = editor()
    const second = drawSecondRoad(view)
    view.tool = 'select'
    const before = structuredClone(view.history.model)
    const steps = view.history.past.length
    view.pointerDown(pointer(500, 500, { 'data-id': 'c' }))
    view.pointerMove(pointer(800, 600))
    assert.equal(view.drag.mergeTarget, second.pointIds[0])
    assert.deepEqual(view.history.model, before)
    const draftPoint = view.drag.draft.points.find(point => point.id === 'c')
    assert.deepEqual(draftPoint, { id: 'c', x: 800, y: 600 })
    view.pointerUp(pointer(800, 600))
    const joined = view.history.model
    assert.equal(joined.roads.length, 1)
    assert.deepEqual(joined.roads[0].pointIds, ['a', 'b', ...second.pointIds])
    assert.equal(joined.points.length, 5)
    assert.equal(joined.points.some(point => point.id === 'c'), false)
    assert.deepEqual([...view.selected], [second.pointIds[0]])
    assert.equal(view.history.past.length, steps + 1)
    assert.deepEqual(model.validateBlueprint(joined), joined)
    view.undo()
    assert.deepEqual(view.history.model, before)
    view.redo()
    assert.deepEqual(view.history.model, joined)
})

test('merge cancellation and leaving the target restore ordinary movement semantics', () => {
    const view = editor()
    const second = drawSecondRoad(view)
    view.tool = 'select'
    const before = structuredClone(view.history.model)
    const steps = view.history.past.length
    view.pointerDown(pointer(500, 500, { 'data-id': 'c' }))
    view.pointerMove(pointer(800, 600))
    assert.equal(view.drag.mergeTarget, second.pointIds[0])
    view.pointerCancel(pointer(800, 600))
    assert.deepEqual(view.history.model, before)
    assert.equal(view.history.past.length, steps)
    view.pointerDown(pointer(500, 500, { 'data-id': 'c' }))
    view.pointerMove(pointer(800, 600))
    view.pointerMove(pointer(700, 700))
    assert.equal(view.drag.mergeTarget, null)
    view.pointerUp(pointer(700, 700))
    assert.equal(view.history.model.roads.length, 2)
    assert.equal(view.history.model.points.length, 6)
    assert.deepEqual(view.history.model.points.find(point => point.id === 'c'), { id: 'c', x: 700, y: 700 })
})

test('endpoint merging lands on the exact target even when grid snapping is enabled', () => {
    const view = editor()
    const second = drawSecondRoad(view)
    view.tool = 'select'
    view.history.model.settings.snap = true
    const target = view.history.model.points.find(point => point.id === second.pointIds[0])
    target.x = 801
    target.y = 601
    view.pointerDown(pointer(500, 500, { 'data-id': 'c' }))
    view.pointerUp(pointer(801, 601))
    assert.equal(view.history.model.roads.length, 1)
    assert.deepEqual(view.history.model.points.find(point => point.id === target.id), target)
})

test('group dragging never merges roads, even when an endpoint is over another endpoint', () => {
    const view = editor()
    drawSecondRoad(view)
    view.tool = 'select'
    view.selected = new Set(['b', 'c'])
    view.pointerDown(pointer(500, 500, { 'data-id': 'c' }))
    view.pointerUp(pointer(800, 600))
    assert.equal(view.history.model.roads.length, 2)
    assert.equal(view.history.model.points.length, 6)
})
