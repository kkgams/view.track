import { createBlueprint, syncTrackSegments } from '../src/model.mjs'
import { SVG_NS, renderTrack, updateTrackViewport, exportBlueprint } from '../src/svg.mjs'
import { trackWheelZoomFactor, zoomTrackCamera } from '../src/interaction.mjs'

// Browser-only regression: real SVG nodes and bubbling WheelEvents, without Host substitutes.
export function runViewportTests() {
    const check = (condition, message) => { if (!condition) throw new Error(message) }
    const model = createBlueprint()
    model.points = [{ id: 'a', x: 200, y: 200 }, { id: 'b', x: 900, y: 200 }, { id: 'c', x: 700, y: 600 }]
    syncTrackSegments(model)
    const exported = exportBlueprint(model)
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('width', '1200')
    svg.setAttribute('height', '800')
    svg.innerHTML = `<rect data-element="viewport-background"/><rect data-element="document-boundary"/>
${renderTrack(model)}<g data-element="points"><circle cx="200" cy="200"/></g>
<rect data-element="selection-box" x="100" y="100" width="300" height="300"/>
<g data-element="segment-overlay"><path data-element="segment-highlight"/><line/><circle/></g>`
    document.body.append(svg)
    try {
        let camera = { x: 0, y: 0, width: 1200, height: 800 }
        let received = 0
        updateTrackViewport(svg, camera)
        const point = svg.querySelector('circle')
        const path = svg.querySelector('defs path')
        const d = path.getAttribute('d')
        const targets = [svg.querySelector('[data-element="viewport-background"]'), svg.querySelector('use'), point]
        svg.addEventListener('wheel', event => {
            event.preventDefault()
            received++
            const anchor = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse())
            camera = zoomTrackCamera(camera, model.viewport, anchor, trackWheelZoomFactor(event.deltaY, event.deltaMode, 800))
            updateTrackViewport(svg, camera)
        }, { passive: false })
        for (const target of targets) {
            received = 0
            const before = model.viewport.width / camera.width
            // Browsers may keep one target for an entire gesture. Do not reacquire it per event.
            for (let event = 0; event < 40; event++) target.dispatchEvent(new WheelEvent('wheel', {
                ctrlKey: true, deltaY: -0.5, clientX: 400, clientY: 300, bubbles: true, cancelable: true,
            }))
            check(received === 40, `Gesture stopped after ${received} of 40 updates`)
            check(target.isConnected, 'The gesture target was replaced')
            check(Math.abs(model.viewport.width / camera.width / before - Math.exp(0.04)) < 1e-9, 'Gesture zoom amount changed')
        }
        check(path === svg.querySelector('defs path') && path.getAttribute('d') === d, 'Zoom replaced or edited road geometry')
        check(point === svg.querySelector('circle'), 'Zoom replaced a point handle')
        let scale = svg.getScreenCTM().a
        check(Math.abs(Number(point.getAttribute('r')) * scale - 9) < 1e-9, 'Handle hit size changed')
        const background = svg.querySelector('[data-element="viewport-background"]')
        check(Number(background.getAttribute('x')) === camera.x && Number(background.getAttribute('width')) === camera.width, 'Background did not follow camera')
        svg.setAttribute('width', '600')
        svg.setAttribute('height', '400')
        updateTrackViewport(svg, camera)
        scale = svg.getScreenCTM().a
        check(Math.abs(Number(point.getAttribute('r')) * scale - 9) < 1e-9, 'Resize changed handle hit size')
        check(Math.abs(Number(svg.querySelector('[data-element="selection-box"]').getAttribute('stroke-width')) * scale - 1.5) < 1e-9, 'Resize changed selection outline size')
        const overlay = svg.querySelector('[data-element="segment-overlay"]')
        check(Math.abs(Number(overlay.querySelector('circle').getAttribute('r')) * scale - 7) < 1e-9, 'Curve handle hit size changed')
        check(Math.abs(Number(overlay.querySelector('line').getAttribute('stroke-width')) * scale - 1.5) < 1e-9, 'Curve handle line size changed')
        check(Math.abs(Number(overlay.querySelector('path').getAttribute('stroke-width')) * scale - 3) < 1e-9, 'Segment highlight size changed')
        check(exportBlueprint(model) === exported, 'Camera updates changed the saved blueprint')
        return { gestures: 3, updatesPerGesture: 40, targetsPreserved: true, geometryPreserved: true, handleSizePreserved: true, segmentOverlaySizePreserved: true, exportUnchanged: true }
    } finally {
        svg.remove()
    }
}
