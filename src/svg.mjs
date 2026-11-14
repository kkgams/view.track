import { validateBlueprint } from './model.mjs'
import { trackPath, trackSegments, segmentPath, trackRoadWidths, trackRoadMesh, roadSurfacePath } from './geometry.mjs'

export const SVG_NS = 'http://www.w3.org/2000/svg'
export function escapeXml(text) {
    return String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\ud800-\udfff]/gu, '\ufffd').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

export function renderTrack(model, id = 'track-centerline', simpleColor = '#263b50') {
    const style = model.rendering
    const reference = escapeXml(id)
    const use = (color, width, dash = '') => `<use href="#${reference}" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
    const profiles = trackRoadWidths(model)
    const roadWidth = profiles.length ? profiles[0].width : style.roadWidth
    const edgeWidth = roadWidth + 2 * style.edgeWidth
    // Keep the exact centerline for markings; vary only the generated road surface.
    const styles = new Map(model.styles.map(style => [style.id, style]))
    const colored = style.mode === 'road' ? trackSegments(model).filter(segment => model.segments[segment.index].styleId !== null) : []
    const closed = model.settings.closed && model.points.length > 2
    const varying = style.mode === 'road' && profiles.some(profile => profile.width !== roadWidth)
    const meshes = varying ? trackRoadMesh(model, profiles) : []
    const overrides = colored.map(segment => {
        const roadStyle = styles.get(model.segments[segment.index].styleId)
        if (!roadStyle) throw new Error('Missing road style')
        const color = roadStyle.roadColor
        if (varying) {
            const caps = { start: !closed && segment.index === 0, end: !closed && segment.index === model.segments.length - 1 }
            return `<path d="${roadSurfacePath(meshes[segment.index], 0, caps)}" fill="${color}"/>`
        }
        let markup = `<path d="${segmentPath(segment)}" stroke="${color}" stroke-width="${roadWidth}" stroke-linecap="butt"/>`
        // Internal color boundaries are flat; only open-route ends need round caps.
        if (!closed) {
            for (const point of [...(segment.index === 0 ? [segment.a] : []), ...(segment.index === model.segments.length - 1 ? [segment.b] : [])]) {
                markup += `<circle cx="${point.x}" cy="${point.y}" r="${roadWidth / 2}" fill="${color}" stroke="none"/>`
            }
        }
        return markup
    })
    const surface = (color, padding) => `<path d="${meshes.map(mesh => roadSurfacePath(mesh, padding)).join(' ')}" fill="${color}"/>`
    const layers = style.mode === 'centerline' ? [use(simpleColor, 12)] : [
        varying ? surface(style.outlineColor, style.edgeWidth + style.outlineWidth) : use(style.outlineColor, edgeWidth + 2 * style.outlineWidth),
        varying ? surface(style.edgeColor, style.edgeWidth) : use(style.edgeColor, edgeWidth),
        varying ? surface(style.roadColor, 0) : use(style.roadColor, roadWidth),
        ...overrides,
        ...(style.centerlineVisible ? [use(style.centerlineColor, 1.5, style.centerlineDash)] : []),
    ]
    return `<defs><path d="${trackPath(model)}" id="${reference}"/></defs>\n<g fill="none" stroke-linecap="round" stroke-linejoin="round" pointer-events="none">${layers.join('')}</g>`
}

// Camera-only updates keep the browser's wheel-gesture target mounted.
export function updateTrackViewport(svg, camera) {
    svg.setAttribute('viewBox', `${camera.x} ${camera.y} ${camera.width} ${camera.height}`)
    const matrix = svg.getScreenCTM()
    if (!matrix || matrix.a <= 0) throw new Error('Track SVG has no screen transform')
    const scale = matrix.a
    const background = svg.querySelector('[data-element="viewport-background"]')
    const boundary = svg.querySelector('[data-element="document-boundary"]')
    if (!background || !boundary) throw new Error('Track SVG is missing its viewport surfaces')
    for (const [name, value] of Object.entries({ x: camera.x, y: camera.y, width: camera.width, height: camera.height })) background.setAttribute(name, value)
    boundary.setAttribute('stroke-width', 1 / scale)
    for (const point of svg.querySelectorAll('[data-element="points"] circle')) {
        point.setAttribute('r', 9 / scale)
        point.setAttribute('stroke-width', 3 / scale)
    }
    for (const handle of svg.querySelectorAll('[data-element="segment-overlay"] circle')) {
        handle.setAttribute('r', 7 / scale)
        handle.setAttribute('stroke-width', 2 / scale)
    }
    for (const line of svg.querySelectorAll('[data-element="segment-overlay"] line')) line.setAttribute('stroke-width', 1.5 / scale)
    const highlight = svg.querySelector('[data-element="segment-highlight"]')
    if (highlight) highlight.setAttribute('stroke-width', 3 / scale)
    const box = svg.querySelector('[data-element="selection-box"]')
    if (box) {
        box.setAttribute('stroke-width', 1.5 / scale)
        box.setAttribute('stroke-dasharray', `${4 / scale} ${4 / scale}`)
    }
}

export function exportBlueprint(model) {
    const checked = validateBlueprint(model)
    const metadata = JSON.stringify(checked).replace(/[\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
    const source = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="${SVG_NS}" width="${checked.viewport.width}" height="${checked.viewport.height}" viewBox="0 0 ${checked.viewport.width} ${checked.viewport.height}">
<title>${escapeXml(checked.name)}</title>
<metadata id="gams-track-blueprint">${escapeXml(metadata)}</metadata>
<rect width="${checked.viewport.width}" height="${checked.viewport.height}" fill="#ffffff"/>
${renderTrack(checked)}
</svg>\n`
    if (source.length > 8 * 1024 * 1024) throw new Error('Blueprint SVG exceeds the 8 MiB import limit')
    return source
}

export function importBlueprint(source, Parser = DOMParser) {
    if (typeof source !== 'string' || source.length > 8 * 1024 * 1024) throw new Error('SVG must be text smaller than 8 MiB')
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('SVG document types and entities are not supported')
    const xml = new Parser().parseFromString(source, 'image/svg+xml')
    if (xml.querySelector('parsererror') || xml.documentElement.localName !== 'svg' || xml.documentElement.namespaceURI !== SVG_NS) throw new Error('Invalid SVG document')
    const metadata = [...xml.documentElement.children].filter(node => node.localName === 'metadata' && node.namespaceURI === SVG_NS && node.id === 'gams-track-blueprint')
    if (metadata.length !== 1) throw new Error('SVG must contain exactly one gams-track-blueprint metadata element')
    // Never mount imported SVG: only the validated model is used to render.
    return validateBlueprint(JSON.parse(metadata[0].textContent))
}
