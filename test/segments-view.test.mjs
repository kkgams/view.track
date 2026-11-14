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
