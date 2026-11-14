import { runtime, unwrap } from '/core/runtime.js'
import { registerViewPlugin, unregisterViewPlugin, viewOk } from '/util/view-plugin.js'

export class ViewTrack extends HTMLElement {
    constructor() {
        super()
        const model = createBlueprint()
        this.history = new TrackHistory(model, { path: '', saved: JSON.stringify(model) })
        this.selected = null
        this.preview = false
        this.insertMode = false
        this.busy = false
        this.drag = null
        this.controls = []
        this.centerlineId = `track-centerline-${crypto.randomUUID()}`
    }

    get path() { return this.history.context.path }
    set path(path) { this.history.context.path = path }
    get saved() { return this.history.context.saved }
    set saved(saved) { this.history.context.saved = saved }

    connectedCallback() {
        const initialSource = this.getAttribute('data-source')
        this.style.display = 'contents'
        this.abort = new AbortController()
        this.innerHTML = `<svg xmlns="${SVG_NS}" width="100%" height="100%" viewBox="0 0 1200 800" tabindex="0" role="img" aria-label="Track editor. Click to add points; drag to move; use Insert point then click a segment."></svg>
<aside><form autocomplete="off">
<fieldset><legend>Blueprint</legend><label>Name <input data-field="name" type="text" maxlength="1000" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></label>
<label><input data-field="closed" type="checkbox"> Closed loop</label>
<label><input data-field="smooth" type="checkbox"> Smooth curves</label></fieldset>
<fieldset><legend>Grid</legend><label><input data-field="grid" type="checkbox"> Show grid</label>
<label><input data-field="snap" type="checkbox"> Snap to grid</label>
<label>Grid size <input data-field="gridSize" type="number" min="5" max="200" step="1" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></label></fieldset>
<fieldset><legend>Road appearance</legend>
<label>Rendering <select data-section="rendering" data-field="mode"><option value="centerline">Centerline only</option><option value="road">Styled road</option></select></label>
<label>Road width <input data-section="rendering" data-field="roadWidth" type="number" min="1" max="200" step="any"></label>
<label>Road color <input data-section="rendering" data-field="roadColor" type="text" maxlength="7" placeholder="#454b55"></label>
<label>Shoulder width per side <input data-section="rendering" data-field="edgeWidth" type="number" min="0" max="50" step="any"></label>
<label>Shoulder color <input data-section="rendering" data-field="edgeColor" type="text" maxlength="7" placeholder="#eeeeee"></label>
<label>Outline thickness per side <input data-section="rendering" data-field="outlineWidth" type="number" min="0" max="50" step="any"></label>
<label>Outline color <input data-section="rendering" data-field="outlineColor" type="text" maxlength="7" placeholder="#15191f"></label>
<label><input data-section="rendering" data-field="centerlineVisible" type="checkbox"> Centerline marking</label>
<label>Marking color <input data-section="rendering" data-field="centerlineColor" type="text" maxlength="7" placeholder="#f5d76e"></label>
<label>Dash lengths (empty = solid) <input data-section="rendering" data-field="centerlineDash" type="text" maxlength="128" placeholder="8 10"></label>
</fieldset></form></aside><footer><output aria-live="polite"></output></footer>`
        this.svg = this.querySelector('svg')
        this.status = this.querySelector('output')
        this.fields = [...this.querySelectorAll('[data-field]')]
        for (const field of this.querySelectorAll('[data-section="rendering"]:is(input[type="text"], input[type="number"])')) {
            for (const attribute of ['autocomplete', 'autocorrect', 'autocapitalize']) field.setAttribute(attribute, 'off')
            field.spellcheck = false
        }
        this.querySelector('form').addEventListener('submit', event => event.preventDefault(), { signal: this.abort.signal })
        for (const field of this.fields) field.addEventListener('change', () => this.changeField(field), { signal: this.abort.signal })
        this.mountControls()
        const listen = (type, method) => this.svg.addEventListener(type, event => this[method](event), { signal: this.abort.signal })
        listen('pointerdown', 'pointerDown')
        listen('pointermove', 'pointerMove')
        listen('pointerup', 'pointerUp')
        listen('pointercancel', 'pointerCancel')
        listen('lostpointercapture', 'pointerCancel')
        listen('keydown', 'keyDown')
        const methods = {}
        for (const method of ['open', 'save', 'saveAs', 'undo', 'redo', 'deleteSelected']) {
            methods[method] = async input => viewOk(await this.perform(() => this[method](input)))
        }
        registerViewPlugin(this, methods)
        const source = this.getAttribute('data-source') || initialSource
        this.render()
        if (source && source !== this.path) void this.perform(() => this.open(source))
    }

    disconnectedCallback() {
        this.cancelDrag()
        this.abort.abort()
        for (const group of this.controls) group.remove()
        this.controls = []
        void unregisterViewPlugin(this)
    }

    mountControls() {
        const groups = [
            ['file-actions', [['open', 'Open SVG'], ['save', 'Save'], ['saveAs', 'Save as'], ['download', 'Download SVG']]],
            ['tool-actions', [['insert', 'Insert point'], ['deleteSelected', 'Delete point'], ['clear', 'Clear']]],
            ['edit-actions', [['undo', 'Undo'], ['redo', 'Redo']]],
            ['view-actions', [['preview', 'Preview']]],
        ]
        const toolbar = document.createElement('div')
        toolbar.slot = 'header-controls'
        for (const [name, actions] of groups) {
            const group = document.createElement('div')
            group.setAttribute('role', 'buttongroup')
            group.dataset.element = name
            for (const [action, label] of actions) {
                const button = document.createElement('button')
                button.type = 'button'
                button.textContent = label
                button.dataset.action = action
                button.addEventListener('click', () => {
                    if (action === 'insert') { this.cancelDrag(); this.insertMode = !this.insertMode; this.render(); return }
                    if (action === 'preview') { this.cancelDrag(); this.preview = !this.preview; this.render(); return }
                    void this.perform(() => this[action]())
                }, { signal: this.abort.signal })
                group.append(button)
            }
            toolbar.append(group)
        }
        this.parentElement.append(toolbar)
        this.controls.push(toolbar)
    }

    async perform(action) {
        if (this.busy) return { err: 'A track file operation is already in progress' }
        this.cancelDrag()
        this.busy = true
        this.render()
        let result
        try { result = await action() }
        catch (error) {
            console.error('Track editor:', error)
            this.status.textContent = `Error: ${error.message}`
            this.status.className = 'danger'
            return { err: error.message }
        } finally {
            this.busy = false
            this.updateControls()
        }
        this.render()
        return result
    }

    changeField(field) {
        if (this.busy || (this.preview && field.dataset.section !== 'rendering')) return
        this.cancelDrag()
        const next = structuredClone(this.history.model)
        const key = field.dataset.field
        if (key === 'name') next.name = field.value
        else {
            const section = field.dataset.section === 'rendering' ? next.rendering : next.settings
            section[key] = field.type === 'checkbox' ? field.checked : field.type === 'number' ? (field.value === '' ? NaN : Number(field.value)) : field.value
        }
        try { this.history.commit(next); this.render() }
        catch (error) { field.setCustomValidity(error.message); field.reportValidity(); field.setCustomValidity(''); this.render() }
    }

    updateControls() {
        const model = this.history.model
        for (const field of this.fields) {
            field.disabled = this.busy || (this.preview && field.dataset.section !== 'rendering')
            const section = field.dataset.section === 'rendering' ? model.rendering : model.settings
            const value = field.dataset.field === 'name' ? model.name : section[field.dataset.field]
            if (field.type === 'checkbox') field.checked = value
            else field.value = value
        }
        for (const group of this.controls) for (const button of group.querySelectorAll('button')) {
            const action = button.dataset.action
            button.disabled = this.busy || (this.preview && ['insert', 'deleteSelected', 'clear'].includes(action)) ||
                (action === 'deleteSelected' && this.selected === null) ||
                (action === 'undo' && !this.history.past.length) || (action === 'redo' && !this.history.future.length)
            if (action === 'preview' || action === 'insert') button.setAttribute('aria-pressed', String(action === 'preview' ? this.preview : this.insertMode))
        }
    }

    render() {
        const model = this.drag ? this.drag.draft : this.history.model
        if (this.path) this.setAttribute('data-source', this.path)
        else this.removeAttribute('data-source')
        if (!model.points.some(point => point.id === this.selected)) this.selected = null
        this.svg.setAttribute('viewBox', `0 0 ${model.viewport.width} ${model.viewport.height}`)
        // Only generated, validated values enter this markup; imported SVG never does.
        const grid = []
        if (!this.preview && model.settings.grid) {
            for (let x = 0; x <= model.viewport.width; x += model.settings.gridSize) grid.push(`M ${x} 0 V ${model.viewport.height}`)
            for (let y = 0; y <= model.viewport.height; y += model.settings.gridSize) grid.push(`M 0 ${y} H ${model.viewport.width}`)
        }
        this.svg.innerHTML = `<rect width="${model.viewport.width}" height="${model.viewport.height}" fill="${this.preview ? '#ffffff' : '#121c28'}"/>
<path d="${grid.join(' ')}" stroke="#344457" stroke-width="1" fill="none" pointer-events="none"/>
${renderTrack(model, this.centerlineId, this.preview ? '#263b50' : '#91e5ff')}
<g data-element="points"></g>`
        if (!this.preview) {
            const layer = this.svg.querySelector('[data-element="points"]')
            model.points.forEach((point, index) => {
                const circle = document.createElementNS(SVG_NS, 'circle')
                for (const [name, value] of Object.entries({ cx: point.x, cy: point.y, r: 9, fill: point.id === this.selected ? '#ffcf66' : '#ffffff', stroke: '#121c28', 'stroke-width': 3, 'data-id': point.id, 'aria-label': `Point ${index + 1}` })) circle.setAttribute(name, value)
                layer.append(circle)
            })
        }
        this.updateControls()
        const dirty = JSON.stringify(this.history.model) !== this.saved
        this.status.className = ''
        this.status.textContent = `${dirty ? 'Unsaved · ' : ''}${this.path || 'New blueprint'} · ${model.points.length} points · ${this.preview ? 'Preview' : this.insertMode ? 'Click a segment to insert a point' : 'Click to add · Drag to move · Delete to remove · Ctrl/Cmd+Z to undo'}`
    }

    canvasPoint(event) {
        const matrix = this.svg.getScreenCTM()
        if (!matrix) throw new Error('Track SVG has no screen transform')
        return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    }

    pointerDown(event) {
        if (event.button !== 0 || this.busy || this.preview || this.drag) return
        const position = this.canvasPoint(event)
        const model = this.history.model
        if (position.x < 0 || position.y < 0 || position.x > model.viewport.width || position.y > model.viewport.height) return
        event.preventDefault()
        this.svg.focus()
        const id = event.target.getAttribute('data-id')
        if (id) {
            this.selected = id
            this.drag = { pointerId: event.pointerId, start: position, draft: structuredClone(model), moved: false }
            this.svg.setPointerCapture(event.pointerId)
            this.render()
            return
        }
        const next = structuredClone(model)
        let index = next.points.length
        let point = position
        if (this.insertMode) {
            const hit = nearestSegment(model, position)
            if (!hit) return
            const scale = this.svg.getScreenCTM()
            if (hit.distance * Math.hypot(scale.a, scale.b) > 20) return
            index = hit.index + 1
            point = hit
        }
        const added = { id: crypto.randomUUID(), ...placePoint(model, point.x, point.y) }
        next.points.splice(index, 0, added)
        this.selected = added.id
        this.history.commit(next)
        this.render()
    }

    pointerMove(event) {
        if (!this.drag || event.pointerId !== this.drag.pointerId) return
        const position = this.canvasPoint(event)
        if (!this.drag.moved && Math.hypot(position.x - this.drag.start.x, position.y - this.drag.start.y) < 2) return
        this.drag.moved = true
        const point = this.drag.draft.points.find(point => point.id === this.selected)
        Object.assign(point, placePoint(this.drag.draft, position.x, position.y))
        this.render()
    }

    pointerUp(event) {
        if (!this.drag || event.pointerId !== this.drag.pointerId) return
        this.pointerMove(event)
        const drag = this.drag
        this.drag = null
        if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId)
        this.history.commit(drag.draft)
        this.render()
    }

    pointerCancel(event) {
        if (this.drag && event.pointerId === this.drag.pointerId) { this.cancelDrag(); this.render() }
    }

    cancelDrag() {
        if (!this.drag) return
        const id = this.drag.pointerId
        this.drag = null
        if (this.svg.hasPointerCapture(id)) this.svg.releasePointerCapture(id)
    }

    keyDown(event) {
        if (this.busy) return
        const mod = event.ctrlKey || event.metaKey
        if (mod && ['z', 'y', 's'].includes(event.key.toLowerCase())) {
            event.preventDefault()
            const key = event.key.toLowerCase()
            void this.perform(() => key === 's' ? this.save() : key === 'y' || event.shiftKey ? this.redo() : this.undo())
        } else if (!this.preview && ['Delete', 'Backspace'].includes(event.key)) {
            event.preventDefault(); this.cancelDrag(); this.deleteSelected(); this.render()
        } else if (event.key === 'Escape') {
            this.cancelDrag(); this.selected = null; this.insertMode = false; this.render()
        }
    }

    deleteSelected() {
        if (this.preview) return
        this.cancelDrag()
        const next = structuredClone(this.history.model)
        next.points = next.points.filter(point => point.id !== this.selected)
        this.history.commit(next)
        this.selected = null
        this.render()
    }
    clear() {
        if (this.preview) return
        const next = structuredClone(this.history.model)
        next.points = []
        next.annotations = []
        this.history.commit(next)
        this.selected = null
        this.render()
    }
    undo() { this.cancelDrag(); this.history.undo(); this.render() }
    redo() { this.cancelDrag(); this.history.redo(); this.render() }

    async choose(mode) {
        const result = unwrap(await runtime.call('ui.popup.open', { title: mode === 'chooser' ? 'Open track SVG' : 'Save track SVG', size: 'medium', tag: 'view-files',
            props: { mode, filter: '*.svg', defaultName: `${this.history.model.name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'track'}.svg` } }))
        if (!result || result.cancelled) return null
        if (mode === 'saver') {
            if (typeof result.path !== 'string' || !result.path) throw new Error('Save chooser returned no path')
            return result.path
        }
        const selection = Array.isArray(result.selection) ? result.selection[0] : result.selection
        if (!selection || typeof selection.path !== 'string' || !selection.path) throw new Error('Open chooser returned no path')
        return selection.path
    }

    async open(input) {
        const path = typeof input === 'string' ? input : input && typeof input.path === 'string' ? input.path : await this.choose('chooser')
        if (!path) return false
        const source = unwrap(await runtime.invoke('fs/fs::read-text', path))
        const model = importBlueprint(source)
        this.cancelDrag()
        // Opening is undoable, so an accidental open cannot discard a sketch.
        this.history.commit(model, { path, saved: JSON.stringify(model) })
        this.selected = null
        this.render()
        return true
    }

    async save() { return this.path ? this.write(this.path) : this.saveAs() }
    async saveAs() {
        const path = await this.choose('saver')
        if (!path) return false
        return this.write(path.endsWith('.svg') ? path : `${path}.svg`)
    }
    async write(path) {
        const model = structuredClone(this.history.model)
        unwrap(await runtime.invoke('fs/fs::write-text', path, exportBlueprint(model)))
        this.path = path
        this.setAttribute('data-source', path)
        this.saved = JSON.stringify(model)
        this.render()
        return true
    }
    download() {
        const url = URL.createObjectURL(new Blob([exportBlueprint(this.history.model)], { type: 'image/svg+xml' }))
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${this.history.model.name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'track'}.svg`
        document.body.append(anchor)
        anchor.click()
        anchor.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
}

customElements.define('view-track', ViewTrack)
