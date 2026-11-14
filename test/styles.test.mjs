import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBlueprint, validateBlueprint, syncTrackSegments, TrackHistory } from '../src/model.mjs'
import { addTrackStyle, updateTrackStyle, removeTrackStyle, setTrackSegmentStyle } from '../src/interaction.mjs'
import { renderTrack, exportBlueprint } from '../src/svg.mjs'

function blueprint() {
    const model = createBlueprint()
    model.points = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 500, y: 100 }, { id: 'c', x: 500, y: 500 }]
    syncTrackSegments(model)
    model.styles = [{ id: 'asphalt', name: 'Asphalt', roadColor: '#123456' }]
    return model
}

test('styles start empty and new styles get independent IDs, unique names and the track color', () => {
    const initial = createBlueprint()
    assert.deepEqual(initial.styles, [])
    initial.rendering.roadColor = '#aabbcc'
    const first = addTrackStyle(initial)
    const next = addTrackStyle(first)
    assert.deepEqual(initial.styles, [])
    assert.equal(next.styles[0].name, 'Road style 1')
    assert.equal(next.styles[1].name, 'Road style 2')
    assert.equal(next.styles[1].roadColor, '#aabbcc')
    assert.notEqual(next.styles[0].id, next.styles[1].id)
    assert.deepEqual(first.styles, [next.styles[0]])
    const renamed = updateTrackStyle(next, next.styles[0].id, 'road STYLE 3', '#123456')
    assert.equal(addTrackStyle(renamed).styles.at(-1).name, 'Road style 1')
})

test('renaming and recoloring a shared style retain IDs and update every assigned segment', () => {
    let model = blueprint()
    model = setTrackSegmentStyle(model, model.segments[0].id, 'asphalt')
    model = setTrackSegmentStyle(model, model.segments[2].id, 'asphalt')
    const before = structuredClone(model)
    const next = updateTrackStyle(model, 'asphalt', 'Dirt', '#aa5500')
    assert.deepEqual(next.segments, before.segments)
    assert.deepEqual(next.points, before.points)
    assert.deepEqual(model, before)
    assert.equal(next.styles[0].id, 'asphalt')
    assert.equal(next.styles[0].name, 'Dirt')
    assert.equal((renderTrack(next).match(/stroke="#aa5500"/g) || []).length, 2)
    assert.equal((renderTrack(model).match(/stroke="#123456"/g) || []).length, 2)
    assert.doesNotMatch(renderTrack(next), /#123456/)
})

test('in-use styles cannot be deleted; unassigning segments permits deletion', () => {
    let model = blueprint()
    model = setTrackSegmentStyle(model, model.segments[0].id, 'asphalt')
    const before = structuredClone(model)
    assert.throws(() => removeTrackStyle(model, 'asphalt'), /in use/)
    assert.deepEqual(model, before)
    model = setTrackSegmentStyle(model, model.segments[0].id, null)
    const deleted = removeTrackStyle(model, 'asphalt')
    assert.deepEqual(deleted.styles, [])
    assert.equal(model.styles.length, 1)
    assert.deepEqual(validateBlueprint(deleted), deleted)
})

test('style CRUD and assignment share the document undo history', () => {
    const history = new TrackHistory(blueprint())
    history.commit(addTrackStyle(history.model))
    const added = history.model.styles.at(-1)
    history.commit(setTrackSegmentStyle(history.model, history.model.segments[0].id, added.id))
    history.commit(updateTrackStyle(history.model, added.id, 'Gravel', '#ff8844'))
    const edited = structuredClone(history.model)
    history.undo()
    assert.equal(history.model.styles.at(-1).name, added.name)
    history.undo()
    assert.equal(history.model.segments[0].styleId, null)
    history.undo()
    assert.equal(history.model.styles.length, 1)
    history.redo(); history.redo(); history.redo()
    assert.deepEqual(history.model, edited)
    assert.equal(history.commit(updateTrackStyle(edited, added.id, 'Gravel', '#ff8844')), false)
})

const invalid = [
    ['missing styles', model => { delete model.styles }],
    ['non-array styles', model => { model.styles = {} }],
    ['too many styles', model => { model.styles = Array.from({ length: 257 }, (_, i) => ({ id: `style-${i}`, name: `Style ${i}`, roadColor: '#123456' })) }],
    ['null style', model => { model.styles = [null] }],
    ['missing style ID', model => { delete model.styles[0].id }],
    ['empty style ID', model => { model.styles[0].id = '' }],
    ['duplicate IDs', model => { model.styles.push({ ...model.styles[0], name: 'Other' }) }],
    ...['', ' ', ' name', 'name ', 'a'.repeat(101), null, 1].map(name => ['bad name', model => { model.styles[0].name = name }]),
    ['duplicate names', model => { model.styles.push({ ...model.styles[0], id: 'other', name: 'ASPHALT' }) }],
    ...[undefined, null, '', '#fff', 'red', '#123456\n', '<script/>'].map(color => ['bad color', model => { model.styles[0].roadColor = color }]),
    ['missing segment style', model => { delete model.segments[0].styleId }],
    ['dangling style', model => { model.segments[0].styleId = 'missing' }],
    ['empty style reference', model => { model.segments[0].styleId = '' }],
    ['nonstring style reference', model => { model.segments[0].styleId = {} }],
]
for (const [label, mutate] of invalid) test(`style validation rejects ${label}`, () => {
    const model = blueprint()
    mutate(model)
    assert.throws(() => validateBlueprint(model), /Invalid blueprint:/)
    assert.throws(() => exportBlueprint(model), /Invalid blueprint:/)
})

test('style limits accept 256 definitions and malformed edits remain atomic', () => {
    const model = blueprint()
    model.styles = Array.from({ length: 256 }, (_, i) => ({ id: `style-${i}`, name: `Style ${i}`, roadColor: '#123456' }))
    assert.deepEqual(validateBlueprint(model), model)
    const before = structuredClone(model)
    assert.throws(() => addTrackStyle(model), /maximum 256/)
    assert.throws(() => updateTrackStyle(model, 'style-0', 'Style 1', '#123456'), /unique/)
    assert.throws(() => updateTrackStyle(model, 'style-0', 'Name', 'red'), /style road color/)
    assert.throws(() => updateTrackStyle(model, 'missing', 'Name', '#123456'), /Missing road style/)
    assert.throws(() => removeTrackStyle(model, 'missing'), /Missing road style/)
    assert.throws(() => setTrackSegmentStyle(model, model.segments[0].id, 'missing'), /Missing road style/)
    assert.deepEqual(model, before)
})

test('style names and extension data serialize safely without becoming SVG markup', () => {
    const model = blueprint()
    model.styles[0].name = '<script>alert("x")</script>'
    model.styles[0].extension = { label: 'Ω' }
    model.segments[0].styleId = 'asphalt'
    const source = exportBlueprint(model)
    assert.doesNotMatch(source, /<script>/)
    const encoded = source.match(/<metadata id="gams-track-blueprint">([^<]*)<\/metadata>/)[1]
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    const decoded = JSON.parse(encoded.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => entities[name]))
    assert.deepEqual(validateBlueprint(decoded), model)
    assert.equal(exportBlueprint(decoded), source)
})
