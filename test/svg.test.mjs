import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBlueprint } from '../src/model.mjs'
import { trackPath } from '../src/geometry.mjs'
import { SVG_NS, escapeXml, exportBlueprint } from '../src/svg.mjs'

// Serialization only; actual XML parsing belongs to browser integration tests.
function metadataJson(svg) {
    const encoded = svg.match(/<metadata id="gams-track-blueprint">([^<]*)<\/metadata>/)[1]
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    return JSON.parse(encoded.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => entities[name]))
}

test('XML escaping handles all five reserved characters and string conversion', () => {
    assert.equal(escapeXml('&<>"\''), '&amp;&lt;&gt;&quot;&apos;')
    assert.equal(escapeXml('&lt;'), '&amp;lt;')
    assert.equal(escapeXml('ordinary Ω 🏁'), 'ordinary Ω 🏁')
    assert.equal(escapeXml(123), '123')
})
test('export emits standalone SVG with dimensions, title, metadata and generated geometry', () => {
    const value = createBlueprint()
    value.name = 'Track Ω 🏁'
    value.points = [{ id: 'a', x: 10, y: 20 }, { id: 'b', x: 90, y: 100 }, { id: 'c', x: 150, y: 30 }]
    const svg = exportBlueprint(value)
    assert.ok(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'))
    assert.ok(svg.includes(`<svg xmlns="${SVG_NS}" width="1200" height="800" viewBox="0 0 1200 800">`))
    assert.ok(svg.includes('<title>Track Ω 🏁</title>'))
    assert.ok(svg.includes(`<path d="${trackPath(value)}"`))
    assert.equal((svg.match(/<metadata /g) || []).length, 1)
    assert.ok(svg.endsWith('</svg>\n'))
    assert.deepEqual(metadataJson(svg), value)
})
test('export preserves extensions and annotations without embedding their markup', () => {
    const value = createBlueprint()
    const attack = '</metadata><script>alert("x")</script><svg onload=\'alert(1)\'>&lt;'
    value.name = attack
    value.extension = { payload: attack, nested: [1, true, null, 'Ω'] }
    value.settings.extension = { data: attack }
    value.viewport.units = 'm'
    value.points = [{ id: attack, x: 1, y: 2, extension: { text: attack } }]
    value.annotations = [{ text: attack }]
    const before = structuredClone(value)
    const svg = exportBlueprint(value)
    assert.doesNotMatch(svg, /<script|<svg onload|<\/metadata><script/)
    assert.equal((svg.match(/<svg /g) || []).length, 1)
    assert.deepEqual(metadataJson(svg), before)
    assert.deepEqual(value, before)
})
test('export geometry covers empty, single, open straight and closed curved tracks', () => {
    const value = createBlueprint()
    assert.match(exportBlueprint(value), /<path d="" /)
    value.points = [{ id: 'a', x: 10, y: 20 }]
    assert.match(exportBlueprint(value), /<path d="M 10 20" /)
    value.points.push({ id: 'b', x: 30, y: 40 }, { id: 'c', x: 50, y: 20 })
    value.settings.closed = false
    value.settings.smooth = false
    assert.match(exportBlueprint(value), /<path d="M 10 20 L 30 40 L 50 20" /)
    value.settings.closed = true
    value.settings.smooth = true
    assert.ok(exportBlueprint(value).includes(`<path d="${trackPath(value)}"`))
    assert.match(trackPath(value), / C .* Z$/)
})
test('export validates before interpolating dimensions, coordinates or metadata', () => {
    for (const mutate of [
        value => { value.viewport.width = '100" onload="alert(1)' },
        value => { value.points = [{ id: 'p', x: '0"/><script/>', y: 0 }] },
        value => { value.settings.smooth = 'false' },
        value => { value.version = 999 },
    ]) {
        const value = createBlueprint()
        mutate(value)
        assert.throws(() => exportBlueprint(value), /Invalid blueprint:/)
    }
})

test('export escapes XML-forbidden characters in metadata without changing the model', () => {
    const model = createBlueprint()
    model.name = 'NUL\0 and \uffff and lone \ud800 and 🏁'
    const svg = exportBlueprint(model)
    assert.equal(/[\u0000\uffff]/u.test(svg), false)
    assert.match(svg, /\\u0000/)
    assert.match(svg, /\\uffff/)
    assert.match(svg, /\\ud800/)
    assert.match(svg, /\\ud83c\\udfc1/)
})

test('export refuses a file larger than the importer can reopen', () => {
    const model = createBlueprint()
    model.extension = 'a'.repeat(8 * 1024 * 1024)
    assert.throws(() => exportBlueprint(model), /8 MiB/)
})
