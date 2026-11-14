import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBlueprint, createRendering, validateRendering, validateBlueprint, TrackHistory, syncTrackSegments } from '../src/model.mjs'
import { trackPath } from '../src/geometry.mjs'
import { renderTrack, exportBlueprint } from '../src/svg.mjs'

function blueprint() {
    const model = createBlueprint()
    model.points = [{ id: 'a', x: 40, y: 80 }, { id: 'b', x: 300, y: 120 }, { id: 'c', x: 180, y: 360 }]
    return syncTrackSegments(model)
}

// Inspect serialization only, without substituting a mock DOM/XML parser.
function elements(source, tag) {
    return [...source.matchAll(new RegExp(`<${tag}\\b([^>]*)/>`, 'g'))].map(match =>
        Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])))
}

function metadataJson(svg) {
    const encoded = svg.match(/<metadata id="gams-track-blueprint">([^<]*)<\/metadata>/)[1]
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    return JSON.parse(encoded.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => entities[name]))
}

test('default road paints four ordered uses of one shared geometry path', () => {
    const model = blueprint()
    const source = renderTrack(model)
    assert.deepEqual(elements(source, 'path'), [{ d: trackPath(model), id: 'track-centerline' }])
    assert.deepEqual(elements(source, 'use'), [
        { href: '#track-centerline', stroke: '#15191f', 'stroke-width': '32' },
        { href: '#track-centerline', stroke: '#eeeeee', 'stroke-width': '28' },
        { href: '#track-centerline', stroke: '#454b55', 'stroke-width': '24' },
        { href: '#track-centerline', stroke: '#f5d76e', 'stroke-width': '1.5', 'stroke-dasharray': '8 10' },
    ])
    assert.match(source, /<g fill="none" stroke-linecap="round" stroke-linejoin="round" pointer-events="none">/)
})

test('edge and outline thickness apply per side, including fractional and zero widths', () => {
    const model = blueprint()
    Object.assign(model.rendering, { roadWidth: 31.5, edgeWidth: 3.25, outlineWidth: 4.5 })
    assert.deepEqual(elements(renderTrack(model), 'use').map(use => use['stroke-width']), ['47', '38', '31.5', '1.5'])
    model.rendering.edgeWidth = 0
    model.rendering.outlineWidth = 0
    assert.deepEqual(elements(renderTrack(model), 'use').map(use => use['stroke-width']), ['31.5', '31.5', '31.5', '1.5'])
})

test('simple centerline mode paints one undashed use even with centerline visibility off', () => {
    const model = blueprint()
    model.rendering.mode = 'centerline'
    model.rendering.centerlineVisible = false
    assert.deepEqual(elements(renderTrack(model), 'use'), [{ href: '#track-centerline', stroke: '#263b50', 'stroke-width': '12' }])
    assert.deepEqual(elements(renderTrack(model, 'simple-track', '#abcdef'), 'use'), [{ href: '#simple-track', stroke: '#abcdef', 'stroke-width': '12' }])
    assert.equal(elements(renderTrack(model), 'path').length, 1)
})

test('hiding centerline preserves the three ordered road layers and shared geometry', () => {
    const model = blueprint()
    const before = elements(renderTrack(model), 'use')
    model.rendering.centerlineVisible = false
    const source = renderTrack(model)
    assert.deepEqual(elements(source, 'use'), before.slice(0, 3))
    assert.deepEqual(elements(source, 'path'), [{ d: trackPath(model), id: 'track-centerline' }])
})

for (const dash of ['', '4 6', '1.5,2.25 0', '0 1000']) test(`centerline supports ${dash || 'solid'} without dashing road layers`, () => {
    const model = blueprint()
    model.rendering.centerlineDash = dash
    assert.deepEqual(validateBlueprint(model), model)
    const uses = elements(renderTrack(model), 'use')
    for (const use of uses.slice(0, 3)) assert.equal(Object.hasOwn(use, 'stroke-dasharray'), false)
    if (dash) assert.equal(uses[3]['stroke-dasharray'], dash)
    else assert.equal(Object.hasOwn(uses[3], 'stroke-dasharray'), false)
})

test('rendering is required blueprint data', () => {
    const model = blueprint()
    delete model.rendering
    assert.throws(() => validateBlueprint(model), /Invalid blueprint: rendering/)
    assert.throws(() => exportBlueprint(model), /Invalid blueprint: rendering/)
})

const invalidRendering = [
    ...[null, undefined, false, [], {}, 'road'].map(value => ['shape', null, value]),
    ...['simple', '', null, 1].map(value => ['mode', 'mode', value]),
    ...[['roadWidth', 1, 200], ['edgeWidth', 0, 50], ['outlineWidth', 0, 50]].flatMap(([key, min, max]) =>
        [min - 0.1, max + 0.1, NaN, Infinity, -Infinity, '24', null, undefined, '1" onload="alert(1)'].map(value => [key, key, value])),
    ...['roadColor', 'edgeColor', 'outlineColor', 'centerlineColor'].flatMap(key =>
        ['red', '#fff', '#12345678', '#gggggg', ' #123456', '#123456\n', null, 123,
            'url(https://example.invalid/paint)', 'url(#paint)', 'var(--paint)',
            '#123456;stroke:red', '#123456"/><script/>', '"><svg onload="alert(1)'].map(value => [key, key, value])),
    ...[0, 1, 'false', null, undefined].map(value => ['visibility', 'centerlineVisible', value]),
    ...[null, 8, [], ' ', '-1 2', '1e2 3', '.5 2', '1. 2', '1;2', '1\n2', '1\t2', '1,', '8,,10', '8, ,10',
        '0', '0 0', '1001 1', 'Infinity', 'NaN', Array(17).fill('1').join(' '), '1'.repeat(129),
        '8" onload="alert(1)', '8/><script/>', 'url(#dash)', 'var(--dash)', '8;stroke:red'].map(value => ['dash', 'centerlineDash', value]),
]

for (const [index, [label, key, value]] of invalidRendering.entries()) test(`reject malformed rendering ${index}: ${label} ${String(value)}`, () => {
    const model = blueprint()
    if (key === null) model.rendering = value
    else model.rendering[key] = value
    assert.throws(() => validateRendering(model.rendering), /Invalid blueprint: rendering/)
    assert.throws(() => validateBlueprint(model), /Invalid blueprint: rendering/)
    assert.throws(() => exportBlueprint(model), /Invalid blueprint: rendering/)
})

test('numeric limits, sixteen dash lengths and six-digit mixed-case colors are accepted', () => {
    for (const [roadWidth, edgeWidth, outlineWidth] of [[1, 0, 0], [200, 50, 50], [12.5, 0.25, 1.75]]) {
        const model = blueprint()
        Object.assign(model.rendering, { roadWidth, edgeWidth, outlineWidth, roadColor: '#AbCdEf', centerlineDash: Array(16).fill('1').join(',') })
        assert.deepEqual(validateBlueprint(model), model)
    }
})

test('custom rendering survives decoded embedded JSON and re-export without aliasing', () => {
    const model = blueprint()
    model.name = 'Road Ω & <"test">'
    model.rendering = { mode: 'road', roadWidth: 43.5, roadColor: '#AbCdEf', edgeWidth: 0.5, edgeColor: '#123456', outlineWidth: 7, outlineColor: '#654321', centerlineVisible: false, centerlineColor: '#FFEEDD', centerlineDash: '1.5,0 12' }
    const before = structuredClone(model)
    const svg = exportBlueprint(model)
    const decoded = metadataJson(svg)
    assert.deepEqual(decoded, before)
    const reopened = validateBlueprint(decoded)
    assert.equal(exportBlueprint(reopened), svg)
    reopened.rendering.roadWidth = 99
    assert.deepEqual(model, before)
    assert.deepEqual(decoded, before)
})

test('rendering history undo and redo leave points and generated geometry unchanged', () => {
    const model = blueprint()
    const history = new TrackHistory(model)
    const initialRendering = structuredClone(model.rendering)
    const points = structuredClone(model.points)
    const geometry = trackPath(model)
    const next = structuredClone(model)
    Object.assign(next.rendering, { mode: 'centerline', roadWidth: 72, centerlineVisible: false, centerlineDash: '' })
    const editedRendering = structuredClone(next.rendering)
    assert.equal(history.commit(next), true)
    next.rendering.roadWidth = 99
    const check = expected => {
        assert.deepEqual(history.model.rendering, expected)
        assert.deepEqual(history.model.points, points)
        assert.equal(trackPath(history.model), geometry)
        assert.equal(elements(renderTrack(history.model), 'path')[0].d, geometry)
    }
    check(editedRendering)
    assert.equal(history.undo(), true)
    check(initialRendering)
    assert.equal(history.redo(), true)
    check(editedRendering)
    assert.deepEqual(model.points, points)
    assert.deepEqual(model.rendering, initialRendering)
})

test('unique custom IDs reference only their own shared path and escape XML characters', () => {
    const model = blueprint()
    const ids = ['editor-road-17', 'preview-road-17']
    const fragments = ids.map(id => renderTrack(model, id))
    assert.equal(new Set(elements(fragments.join(''), 'path').map(path => path.id)).size, 2)
    for (const [index, id] of ids.entries()) {
        assert.deepEqual(elements(fragments[index], 'path'), [{ d: trackPath(model), id }])
        assert.deepEqual(elements(fragments[index], 'use').map(use => use.href), Array(4).fill(`#${id}`))
    }
    const escaped = renderTrack(model, 'track"<&\'')
    assert.equal(elements(escaped, 'path')[0].id, 'track&quot;&lt;&amp;&apos;')
    assert.ok(elements(escaped, 'use').every(use => use.href === '#track&quot;&lt;&amp;&apos;'))
})

test('export rejects invalid styling before attempting any styling interpolation', () => {
    const model = blueprint()
    let interpolated = false
    model.rendering.roadColor = Object.defineProperty({}, 'toString', {
        value() { interpolated = true; throw new Error('Styling was interpolated') },
    })
    assert.throws(() => exportBlueprint(model), /Invalid blueprint: rendering roadColor/)
    assert.equal(interpolated, false)
})

test('segment asphalt overrides sit above road paint but below continuous center markings', () => {
    const model = blueprint()
    model.segments[0].roadColor = '#aa3300'
    model.segments[2].roadColor = '#33aa00'
    const source = renderTrack(model)
    const paths = elements(source, 'path')
    assert.equal(paths.length, 3)
    assert.equal(paths[0].d, trackPath(model))
    assert.equal(paths[1].stroke, '#aa3300')
    assert.equal(paths[2].stroke, '#33aa00')
    for (const path of paths.slice(1)) {
        assert.equal(path['stroke-width'], String(model.rendering.roadWidth))
        assert.equal(path['stroke-linecap'], 'butt')
    }
    assert.ok(source.indexOf('stroke="#454b55"') < source.indexOf('stroke="#aa3300"'))
    assert.ok(source.indexOf('stroke="#33aa00"') < source.indexOf('stroke="#f5d76e"'))
    assert.equal(elements(source, 'circle').length, 0)
    assert.deepEqual(elements(source, 'use').map(use => use.stroke), ['#15191f', '#eeeeee', '#454b55', '#f5d76e'])
})

test('open road overrides retain round outer caps without rounding internal color boundaries', () => {
    const model = blueprint()
    model.settings.closed = false
    syncTrackSegments(model)
    model.segments[0].roadColor = '#aa3300'
    model.segments[1].roadColor = '#33aa00'
    const source = renderTrack(model)
    assert.deepEqual(elements(source, 'circle'), [
        { cx: '40', cy: '80', r: '12', fill: '#aa3300', stroke: 'none' },
        { cx: '180', cy: '360', r: '12', fill: '#33aa00', stroke: 'none' },
    ])
})

test('centerline-only rendering retains segment colors in metadata without painting asphalt', () => {
    const model = blueprint()
    model.segments[0].roadColor = '#aa3300'
    model.rendering.mode = 'centerline'
    assert.equal(elements(renderTrack(model), 'path').length, 1)
    assert.equal(elements(renderTrack(model), 'circle').length, 0)
    assert.doesNotMatch(renderTrack(model), /#aa3300/)
    assert.equal(metadataJson(exportBlueprint(model)).segments[0].roadColor, '#aa3300')
})

for (const color of [undefined, '', '#fff', 'red', 123, {}, '#123456\n', 'url(#paint)', '#123456"/><script/>']) {
    test(`reject invalid segment road color ${String(color)}`, () => {
        const model = blueprint()
        model.segments[0].roadColor = color
        assert.throws(() => validateBlueprint(model), /segment road color/)
        assert.throws(() => exportBlueprint(model), /segment road color/)
    })
}

test('segment color accepts mixed-case hex and null inheritance', () => {
    const model = blueprint()
    model.segments[0].roadColor = '#AbCdEf'
    assert.deepEqual(validateBlueprint(model), model)
    assert.equal(metadataJson(exportBlueprint(model)).segments[1].roadColor, null)
    assert.match(renderTrack(model), /stroke="#AbCdEf"/)
})
