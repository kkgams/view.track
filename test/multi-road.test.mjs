import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBlueprint, validateBlueprint, trackPointPairs, trackRoads, syncTrackSegments } from '../src/model.mjs'
import { trackSegments, trackPath, trackRoadWidths, trackRoadMesh, nearestSegment } from '../src/geometry.mjs'
import { exportBlueprint, renderTrack } from '../src/svg.mjs'

function fixture(closed = false) {
    const model = createBlueprint()
    model.points = [[10,20], [100,20], [100,100], [500,500], [600,500], [600,600]].map(([x,y], index) => ({id: String(index), x, y}))
    model.roads = [{id:'first', closed, pointIds:['0','1','2']}, {id:'second', closed:false, pointIds:['3','4','5']}]
    return syncTrackSegments(model)
}

// Native serialization roundtrip; no browser or parser mocks.
function metadata(svg) {
    const encoded = svg.match(/<metadata id="gams-track-blueprint">([^<]*)<\/metadata>/)[1]
    const entities = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'"}
    return JSON.parse(encoded.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => entities[name]))
}

test('v2 empty blueprint and explicit ordered membership', () => {
    const empty = createBlueprint()
    assert.equal(empty.version, 2)
    assert.deepEqual(empty.roads, [])
    assert.equal(Object.hasOwn(empty.settings, 'closed'), false)
    assert.equal(trackPath(empty), '')
    const model = fixture(true)
    model.points.reverse()
    assert.deepEqual(trackPointPairs(model).map(pair => pair.map(point => point.id)), [['0','1'],['1','2'],['2','0'],['3','4'],['4','5']])
    assert.equal(trackRoads(model)[1].segments[0], model.segments[3])
    assert.deepEqual(validateBlueprint(model), model)
})

test('deletion and insertion retain other-road records without connecting roads', () => {
    const model = fixture()
    const retained = model.segments.slice(2)
    retained[0].extension = {keep:true}
    model.points = model.points.filter(point => point.id !== '1')
    model.roads[0].pointIds = ['0','2']
    syncTrackSegments(model)
    assert.equal(model.segments[1], retained[0])
    model.points.push({id:'new', x:40, y:40})
    model.roads[0].pointIds.splice(1,0,'new')
    syncTrackSegments(model)
    assert.equal(model.segments[2], retained[0])
    assert.equal(model.segments[3], retained[1])
    assert.deepEqual(validateBlueprint(model), model)
})

for (const [name, mutate] of [
    ['missing roads', m => {delete m.roads}],
    ['road cap', m => {m.roads = Array(10001).fill(m.roads[0])}],
    ['empty road', m => {m.roads[0].pointIds = []}],
    ['duplicate road ID', m => {m.roads[1].id = 'first'}],
    ['empty road ID', m => {m.roads[0].id = ''}],
    ['closure', m => {m.roads[0].closed = 1}],
    ['dangling membership', m => {m.roads[0].pointIds[0] = 'missing'}],
    ['local duplicate', m => {m.roads[0].pointIds.push('0')}],
    ['cross-road duplicate', m => {m.roads[1].pointIds.push('0')}],
    ['unowned point', m => {m.roads[0].pointIds.pop()}],
    ['global closure', m => {m.settings.closed = false}],
]) test(`strict ownership rejects ${name}`, () => {
    const model = fixture()
    mutate(model)
    assert.throws(() => validateBlueprint(model), /Invalid blueprint:/)
})

test('geometry, widths and SVG caps are road-local with global segment indices', () => {
    const model = fixture(true)
    const before = trackSegments(model).slice(0,3)
    model.points[3].x += 1000
    assert.deepEqual(trackSegments(model).slice(0,3), before)
    assert.deepEqual(trackRoadMesh(model).map(mesh => mesh.index), [0,1,2,3,4])
    assert.equal(nearestSegment(model, model.points[3]).index, 3)
    assert.equal((trackPath(model).match(/M /g) || []).length, 2)
    assert.equal((trackPath(model).match(/ Z/g) || []).length, 1)
    model.styles = [20,40,60,100,200].map((roadWidth,index) => ({id:`s${index}`, name:`Style ${index}`, roadWidth, roadColor:'#123456'}))
    model.segments.forEach((segment,index) => {segment.styleId = `s${index}`})
    assert.deepEqual(trackRoadWidths(model), [
        {width:20,start:40,end:30}, {width:40,start:30,end:50}, {width:60,start:50,end:40},
        {width:100,start:100,end:150}, {width:200,start:150,end:200},
    ])
    assert.doesNotMatch(renderTrack(model), /NaN|Infinity/)
    model.styles.forEach(style => {style.roadWidth = 24})
    const svg = renderTrack(model)
    assert.equal((svg.match(/<circle /g) || []).length, 2)
    assert.match(svg, /cy="500"/)
    assert.match(svg, /cy="600"/)
})

test('varying-width colored caps and short closed roads remain independent', () => {
    const model = fixture()
    model.styles = [{id:'wide', name:'Wide', roadWidth:100, roadColor:'#123456'}]
    model.segments.forEach(segment => {segment.shape = 'straight'})
    model.segments[1].styleId = 'wide'
    model.segments[2].styleId = 'wide'
    const overrides = [...renderTrack(model).matchAll(/<path d="([^"]*)" fill="#123456"\/>/g)]
    assert.equal(overrides.length, 2)
    overrides.forEach(match => assert.match(match[1], / A 50 50 /))
    model.points = model.points.slice(0,3)
    model.roads = [{id:'single', closed:true, pointIds:['0']}, {id:'pair', closed:true, pointIds:['1','2']}]
    syncTrackSegments(model)
    assert.equal(model.segments.length, 1)
    assert.equal(trackPath(model), 'M 10 20 M 100 20 L 100 100')
    model.points.push({id:'orphan', x:0, y:0})
    assert.throws(() => syncTrackSegments(model), /every point must belong/)
})

test('strict legacy validation precedes deterministic migration and SVG metadata roundtrip', () => {
    for (const closed of [false,true]) {
        const model = fixture(closed)
        model.points = model.points.slice(0,3)
        model.segments = model.segments.slice(0,closed ? 3 : 2)
        delete model.roads
        model.version = 1
        model.settings.closed = closed
        model.extension = {text:'Ω & </metadata>'}
        model.settings.extension = 'keep'
        model.points[0].extension = 'keep'
        model.segments[0].extension = 'keep'
        const original = structuredClone(model)
        const checked = validateBlueprint(model)
        assert.deepEqual(model, original)
        assert.equal(checked.version, 2)
        assert.deepEqual(checked.roads, [{id:'road-1', closed, pointIds:['0','1','2']}])
        assert.equal(Object.hasOwn(checked.settings,'closed'), false)
        assert.deepEqual(checked.points, model.points)
        assert.deepEqual(checked.segments, model.segments)
        assert.deepEqual(checked.extension, model.extension)
        assert.equal(checked.settings.extension, 'keep')
        assert.deepEqual(validateBlueprint(metadata(exportBlueprint(model))), checked)
        for (const mutate of [m => {m.settings.closed = 1}, m => {m.segments.pop()}, m => {m.segments[0].to = '2'}, m => {m.roads = []}]) {
            const broken = structuredClone(model)
            mutate(broken)
            assert.throws(() => validateBlueprint(broken), /Invalid blueprint:/)
        }
    }
    const model = fixture(true)
    model.roads[0].extension = {keep:true}
    assert.deepEqual(validateBlueprint(metadata(exportBlueprint(model))), model)
})
