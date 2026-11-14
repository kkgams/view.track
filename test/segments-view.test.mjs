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
    model.syncTrackSegments(value)
    const view = Object.create(ViewTrack.prototype)
    Object.assign(view, {
        history: new model.TrackHistory(value, { path: '', saved: JSON.stringify(value) }),
        selected: new Set(), selectedSegment: null, drag: null, busy: false, preview: false,
        tool: 'select', spacePressed: false, renders: 0,
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

test('Insert splits a straight segment without turning it into curves', () => {
    const view = editor()
    const id = view.history.model.segments[0].id
    view.history.commit(interaction.editTrackSegment(view.history.model, id, 'straight'))
    view.tool = 'insert'
    view.pointerDown(pointer(300, 100))
    assert.equal(view.history.model.points.length, 4)
    assert.deepEqual(view.history.model.segments.slice(0, 2).map(segment => segment.shape), ['straight', 'straight'])
    assert.deepEqual(model.validateBlueprint(view.history.model), view.history.model)
})

test('segment color inspector commits overrides and resets to track color, including in preview', () => {
    const view = editor()
    view.selectedSegment = view.history.model.segments[0].id
    view.segmentColor = { value: '#AbCdEf' }
    view.changeSegmentColor(false)
    assert.equal(view.history.model.segments[0].roadColor, '#AbCdEf')
    view.preview = true
    view.changeSegmentColor(true)
    assert.equal(view.history.model.segments[0].roadColor, null)
    assert.equal(view.segmentColor.value, '')
    view.undo()
    assert.equal(view.history.model.segments[0].roadColor, '#AbCdEf')
    view.busy = true
    view.changeSegmentColor(true)
    assert.equal(view.history.model.segments[0].roadColor, '#AbCdEf')
})

test('invalid color input reports validation without changing the document or history', () => {
    const view = editor()
    view.selectedSegment = view.history.model.segments[0].id
    let reports = 0
    view.segmentColor = { value: 'red', setCustomValidity() {}, reportValidity() { reports++ } }
    view.changeSegmentColor(false)
    assert.equal(reports, 1)
    assert.equal(view.history.past.length, 0)
    assert.equal(view.history.model.segments[0].roadColor, null)
    view.segmentColor.value = ''
    view.changeSegmentColor(false)
    assert.equal(view.history.past.length, 0)
})
