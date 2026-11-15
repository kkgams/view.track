import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBlueprint, syncTrackSegments, validateBlueprint, TrackHistory } from '../src/model.mjs'
import { addTrackStyle, updateTrackStyle, insertTrackPoint } from '../src/interaction.mjs'
import { trackPath, trackSegments, trackRoadWidths, roadWidthAt, trackRoadMesh, roadSurfacePath, segmentPoint } from '../src/geometry.mjs'
import { renderTrack, exportBlueprint } from '../src/svg.mjs'

function blueprint(closed = false) {
    const model = createBlueprint()
    model.settings.snap = false
    model.points = [0, 300, 900, 1200].map((x, index) => ({ id: String(index), x, y: 300 }))
    model.roads = [{ id: 'road-1', closed, pointIds: model.points.map(point => point.id) }]
    syncTrackSegments(model)
    model.segments.forEach(segment => { segment.shape = 'straight' })
    model.styles = [{ id: 'wide', name: 'Wide road', roadColor: '#aa5533', roadWidth: 80 }]
    model.segments[1].styleId = 'wide'
    return model
}
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`)

test('adjacent road widths share averaged boundary widths and open ends retain their own width', () => {
    const profiles = trackRoadWidths(blueprint())
    assert.deepEqual(profiles, [
        { width: 24, start: 24, end: 52 },
        { width: 80, start: 52, end: 52 },
        { width: 24, start: 52, end: 24 },
    ])
    profiles.forEach(profile => {
        assert.equal(roadWidthAt(profile, 0), profile.start)
        assert.equal(roadWidthAt(profile, 0.5), profile.width)
        assert.equal(roadWidthAt(profile, 1), profile.end)
        for (let step = 0; step <= 100; step++) {
            const width = roadWidthAt(profile, step / 100)
            assert.ok(width >= Math.min(profile.start, profile.width, profile.end) - 1e-9)
            assert.ok(width <= Math.max(profile.start, profile.width, profile.end) + 1e-9)
        }
        for (const [a, b] of [[0, 1e-7], [0.5 - 1e-7, 0.5], [0.5, 0.5 + 1e-7], [1 - 1e-7, 1]]) {
            near((roadWidthAt(profile, b) - roadWidthAt(profile, a)) / (b - a), 0, 0.001)
        }
    })
})

test('closed-loop seam uses the same width on both sides', () => {
    const model = blueprint(true)
    model.segments[0].styleId = 'wide'
    const profiles = trackRoadWidths(model)
    assert.equal(profiles[0].start, 52)
    assert.equal(profiles.at(-1).end, 52)
    profiles.forEach((profile, index) => assert.equal(profile.end, profiles[(index + 1) % profiles.length].start))
})

test('road mesh includes the target width at arc-length midpoint, independent of curve parameter speed', () => {
    const model = blueprint()
    model.segments[1].shape = 'curve'
    model.segments[1].handles = { start: { x: 0, y: 0 }, end: { x: -600, y: 0 } }
    const segment = trackSegments(model)[1]
    assert.equal(segmentPoint(segment, 0.5).x, 375)
    const mesh = trackRoadMesh(model)[1]
    const middle = mesh.samples.find(sample => Math.abs(sample.width - 80) < 1e-12)
    assert.ok(middle)
    near(middle.x, 600)
    near(middle.y, 300)
    assert.equal(mesh.samples[0].width, 52)
    assert.equal(mesh.samples.at(-1).width, 52)
})

test('surface padding adds fixed shoulders and outlines to the varying asphalt width', () => {
    const mesh = trackRoadMesh(blueprint())[0]
    assert.match(roadSurfacePath(mesh, 0), /^M 0 312 /)
    assert.match(roadSurfacePath(mesh, 2), /^M 0 314 /)
    assert.match(roadSurfacePath(mesh, 4), /^M 0 316 /)
    const next = trackRoadMesh(blueprint())[1]
    assert.match(roadSurfacePath(next, 0), /^M 300 326 /)
    assert.match(roadSurfacePath(next, 2), /^M 300 328 /)
    assert.match(roadSurfacePath(next, 4), /^M 300 330 /)
})

test('constant width uses exact SVG strokes while differing widths use filled ribbons below exact markings', () => {
    const model = blueprint()
    const rendered = renderTrack(model)
    assert.match(rendered, /fill="#15191f"/)
    assert.match(rendered, /fill="#eeeeee"/)
    assert.match(rendered, /fill="#454b55"/)
    assert.match(rendered, /fill="#aa5533"/)
    assert.ok(rendered.indexOf('fill="#aa5533"') < rendered.indexOf('stroke="#f5d76e"'))
    assert.ok(rendered.includes(`d="${trackPath(model)}"`))
    assert.match(rendered, /stroke="#f5d76e" stroke-width="1.5" stroke-dasharray="8 10"/)
    model.segments.forEach(segment => { segment.styleId = 'wide' })
    const uniform = renderTrack(model)
    assert.match(uniform, /stroke="#454b55" stroke-width="80"/)
    assert.match(uniform, /stroke="#eeeeee" stroke-width="84"/)
    assert.match(uniform, /stroke="#15191f" stroke-width="88"/)
    assert.doesNotMatch(uniform, /fill="#15191f"/)
})

test('unused wide styles and centerline-only mode do not change displayed road geometry', () => {
    const model = blueprint()
    model.segments[1].styleId = null
    const before = renderTrack(model)
    model.styles[0].roadWidth = 200
    assert.equal(renderTrack(model), before)
    model.segments[1].styleId = 'wide'
    model.rendering.mode = 'centerline'
    assert.match(renderTrack(model), /stroke="#263b50" stroke-width="12"/)
    assert.doesNotMatch(renderTrack(model), /fill="#aa5533"/)
})

test('coincident points, cusps, and manual loops produce finite road meshes', () => {
    for (const closed of [false, true]) {
        for (const mode of ['coincident', 'cusp', 'loop']) {
            const model = blueprint(closed)
            if (mode === 'coincident') model.points.forEach(point => { point.x = 100; point.y = 100 })
            if (mode === 'cusp') model.points[2].x = -300
            if (mode === 'loop') {
                model.segments[1].shape = 'curve'
                model.segments[1].handles = { start: { x: 1000, y: 500 }, end: { x: -1000, y: -500 } }
            }
            const before = structuredClone(model)
            const meshes = trackRoadMesh(model)
            for (const mesh of meshes) {
                assert.ok(mesh.samples.length >= 1)
                for (const sample of mesh.samples) for (const value of [sample.x, sample.y, sample.width, sample.normal.x, sample.normal.y]) assert.ok(Number.isFinite(value))
                assert.doesNotMatch(roadSurfacePath(mesh), /NaN|Infinity|undefined/)
            }
            assert.doesNotMatch(renderTrack(model), /NaN|Infinity|undefined/)
            assert.deepEqual(model, before)
        }
    }
})

for (const width of [undefined, null, '', '24', NaN, Infinity, -Infinity, 0, 200.01]) test(`reject invalid style width ${width}`, () => {
    const model = blueprint()
    model.styles[0].roadWidth = width
    assert.throws(() => validateBlueprint(model), /style road width/)
    assert.throws(() => exportBlueprint(model), /style road width/)
})

test('style width supports documented limits, copies track defaults, and shares undo history', () => {
    const model = blueprint()
    const history = new TrackHistory(model)
    for (const width of [1, 200, 42.5]) {
        history.commit(updateTrackStyle(history.model, 'wide', 'Wide road', '#aa5533', width))
        assert.equal(history.model.styles[0].roadWidth, width)
    }
    const changed = trackRoadWidths(history.model)
    history.undo()
    assert.equal(history.model.styles[0].roadWidth, 200)
    history.redo()
    assert.deepEqual(trackRoadWidths(history.model), changed)
    model.rendering.roadWidth = 31.5
    assert.equal(addTrackStyle(model).styles.at(-1).roadWidth, 31.5)
    assert.equal(history.model.styles[0].roadWidth, 42.5)
    const id = history.model.segments[1].id
    const point = { id: 'inserted', ...segmentPoint(trackSegments(history.model)[1], 0.5) }
    const split = insertTrackPoint(history.model, 1, point, 0.5)
    assert.equal(split.segments[1].id, id)
    assert.equal(split.segments[1].styleId, 'wide')
    assert.equal(split.segments[2].styleId, 'wide')
    assert.equal(split.styles[0].roadWidth, 42.5)
})

test('symmetric closed curves do not duplicate a sample at the arc-length midpoint', () => {
    const model = createBlueprint()
    model.points = [{ id: 'a', x: 200, y: 200 }, { id: 'b', x: 900, y: 200 }, { id: 'c', x: 900, y: 600 }, { id: 'd', x: 200, y: 600 }]
    model.roads = [{ id: 'road-1', closed: true, pointIds: model.points.map(point => point.id) }]
    syncTrackSegments(model)
    model.styles = [{ id: 'wide', name: 'Wide', roadColor: '#aa5533', roadWidth: 120 }]
    model.segments[0].styleId = 'wide'
    for (const mesh of trackRoadMesh(model)) {
        for (const sample of mesh.samples) {
            assert.ok(Number.isFinite(sample.normal.x) && Number.isFinite(sample.normal.y))
        }
        assert.doesNotMatch(roadSurfacePath(mesh), /NaN|Infinity/)
    }
    assert.doesNotMatch(exportBlueprint(model), /NaN|Infinity/)
})
