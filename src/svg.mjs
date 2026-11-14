import { validateBlueprint } from './model.mjs'
import { trackPath } from './geometry.mjs'

export const SVG_NS = 'http://www.w3.org/2000/svg'
export function escapeXml(text) {
    return String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\ud800-\udfff]/gu, '\ufffd').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

export function exportBlueprint(model) {
    const checked = validateBlueprint(model)
    const metadata = JSON.stringify(checked).replace(/[\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
    const source = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="${SVG_NS}" width="${checked.viewport.width}" height="${checked.viewport.height}" viewBox="0 0 ${checked.viewport.width} ${checked.viewport.height}">
<title>${escapeXml(checked.name)}</title>
<metadata id="gams-track-blueprint">${escapeXml(metadata)}</metadata>
<rect width="${checked.viewport.width}" height="${checked.viewport.height}" fill="#ffffff"/>
<path d="${trackPath(checked)}" fill="none" stroke="#263b50" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
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
