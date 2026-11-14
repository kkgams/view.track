import assert from 'node:assert/strict'
import { test } from 'node:test'
import { trackWheelZoomFactor, zoomTrackCamera } from '../src/interaction.mjs'

const viewport = { width: 1200, height: 800 }
const initial = { x: 0, y: 0, width: 1200, height: 800 }
const anchor = { x: 340, y: 250 }
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)

test('small trackpad deltas produce smaller changes than larger deltas', () => {
    const small = trackWheelZoomFactor(-0.25, 0, 800)
    const large = trackWheelZoomFactor(-25, 0, 800)
    assert.ok(small > 1 && small < large)
    assert.ok(small < 1.01)
    assert.equal(trackWheelZoomFactor(0, 0, 800), 1)
})

test('splitting one continuous gesture across events does not change its zoom amount', () => {
    let camera = initial
    for (let index = 0; index < 100; index++) camera = zoomTrackCamera(camera, viewport, anchor, trackWheelZoomFactor(-0.5, 0, 800))
    const once = zoomTrackCamera(initial, viewport, anchor, trackWheelZoomFactor(-50, 0, 800))
    for (const key of ['x', 'y', 'width', 'height']) near(camera[key], once[key])
})

test('wheel zoom is symmetric and normalizes pixel, line and page units', () => {
    near(trackWheelZoomFactor(13, 0, 800) * trackWheelZoomFactor(-13, 0, 800), 1)
    near(trackWheelZoomFactor(-16, 0, 800), trackWheelZoomFactor(-1, 1, 800))
    near(trackWheelZoomFactor(-800, 0, 800), trackWheelZoomFactor(-1, 2, 800))
})

test('continuous zoom retains the pointer anchor and scale bounds', () => {
    let camera = initial
    for (let index = 0; index < 500; index++) {
        camera = zoomTrackCamera(camera, viewport, anchor, trackWheelZoomFactor(-0.5, 0, 800))
        near((anchor.x - camera.x) / camera.width, anchor.x / initial.width)
        near((anchor.y - camera.y) / camera.height, anchor.y / initial.height)
    }
    near(viewport.width / zoomTrackCamera(camera, viewport, anchor, trackWheelZoomFactor(-100000, 0, 800)).width, 64)
    near(viewport.width / zoomTrackCamera(camera, viewport, anchor, trackWheelZoomFactor(100000, 0, 800)).width, 0.02)
})
