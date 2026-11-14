import { runtime, unwrap } from '/core/runtime.js'
import { registerViewPlugin, unregisterViewPlugin, viewOk } from '/util/view-plugin.js'

export class ViewTrack extends HTMLElement {
    constructor() {
        super()
        const model = createBlueprint()
        this.history = new TrackHistory(model, { path: '', saved: JSON.stringify(model) })
        this.selected = new Set()
        this.selectedSegment = null
        this.selectedStyle = null
        this.preview = false
        this.tool = 'draw'
        this.spacePressed = false
        this.camera = { x: 0, y: 0, width: model.viewport.width, height: model.viewport.height }
        this.busy = false
        this.drag = null
        this.controls = []
        this.centerlineId = `track-centerline-${crypto.randomUUID()}`
        this.resizeObserver = new ResizeObserver(entries => {
            if (this.isConnected && entries.some(entry => entry.contentRect.width > 0 && entry.contentRect.height > 0)) this.renderViewport()
        })
    }

    get path() { return this.history.context.path }
    set path(path) { this.history.context.path = path }
    get saved() { return this.history.context.saved }
    set saved(saved) { this.history.context.saved = saved }

    connectedCallback() {
        const initialSource = this.getAttribute('data-source')
        this.style.display = 'contents'
        this.abort = new AbortController()
        this.innerHTML = `<svg xmlns="${SVG_NS}" width="100%" height="100%" viewBox="0 0 1200 800" tabindex="0" role="img" aria-label="Track editor. Draw points, select points or segments, insert points, or pan. Shift-click extends selection. Hold Space to pan."></svg>
<aside><fieldset><legend>Road styles</legend>
<table class="compact-actions" aria-label="Road styles"><thead><tr><th scope="col">Name</th><th scope="col">Used</th><th scope="col">Action</th></tr></thead><tbody data-element="road-styles"></tbody></table>
<button type="button" data-element="add-style">Add road style</button>
</fieldset><form autocomplete="off">
<fieldset data-element="style-properties" disabled><legend>Style properties</legend>
<label>Name <input data-element="style-name" type="text" maxlength="100" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></label>
<label>Road color <input data-element="style-color" type="text" maxlength="7" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></label>
<label>Road width <input data-element="style-width" type="number" min="1" max="200" step="any" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></label>
</fieldset>
<fieldset><legend>Blueprint</legend><label>Name <input data-field="name" type="text" maxlength="1000" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></label>
<label><input data-field="closed" type="checkbox"> Closed loop</label>
</fieldset>
<fieldset data-element="segment-inspector"><legend>Segment</legend>
<label>Selected segment <select data-element="segment-picker" aria-label="Selected segment"></select></label>
<label>Shape <select data-element="segment-shape"><option value="straight">Straight</option><option value="curve">Curved</option></select></label>
<label>Road style <select data-element="segment-style"></select></label>
<label>Start handle X <input data-handle="start" data-axis="x" type="number" step="any"></label>
<label>Start handle Y <input data-handle="start" data-axis="y" type="number" step="any"></label>
<label>End handle X <input data-handle="end" data-axis="x" type="number" step="any"></label>
<label>End handle Y <input data-handle="end" data-axis="y" type="number" step="any"></label>
<button type="button" data-element="reset-handles">Reset curve handles</button>
</fieldset>
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
        this.segmentPicker = this.querySelector('[data-element="segment-picker"]')
        this.segmentShape = this.querySelector('[data-element="segment-shape"]')
        this.segmentStyle = this.querySelector('[data-element="segment-style"]')
        this.styleRows = this.querySelector('[data-element="road-styles"]')
        this.styleProperties = this.querySelector('[data-element="style-properties"]')
        this.styleName = this.querySelector('[data-element="style-name"]')
        this.styleColor = this.querySelector('[data-element="style-color"]')
        this.styleWidth = this.querySelector('[data-element="style-width"]')
        this.stylePropertiesId = null
        for (const field of [this.styleName, this.styleColor, this.styleWidth]) field.addEventListener('change', () => this.changeStyle(field), { signal: this.abort.signal })
        this.styleRows.addEventListener('click', event => {
            if (this.busy || event.target.closest('button')) return
            const row = event.target.closest('tr[data-style-id]')
            if (row) this.selectStyle(row.dataset.styleId, true)
        }, { signal: this.abort.signal })
        this.styleRows.addEventListener('keydown', event => this.styleKeyDown(event), { signal: this.abort.signal })
        this.styleEditors = new Map()
        this.styleChoices = null
        this.segmentChoices = null
        this.addStyleButton = this.querySelector('[data-element="add-style"]')
        this.addStyleButton.addEventListener('click', () => this.addStyle(), { signal: this.abort.signal })
        this.handleFields = [...this.querySelectorAll('[data-handle]')]
        this.resetHandles = this.querySelector('[data-element="reset-handles"]')
        for (const field of this.handleFields) {
            for (const attribute of ['autocomplete', 'autocorrect', 'autocapitalize']) field.setAttribute(attribute, 'off')
            field.spellcheck = false
            field.addEventListener('change', () => this.changeHandle(field), { signal: this.abort.signal })
        }
        this.segmentPicker.addEventListener('change', () => {
            if (this.busy || this.preview) return
            this.cancelDrag()
            this.selected.clear()
            this.selectedSegment = this.segmentPicker.value || null
            this.render()
        }, { signal: this.abort.signal })
        this.segmentShape.addEventListener('change', () => this.changeSegment(false), { signal: this.abort.signal })
        this.segmentStyle.addEventListener('change', () => this.changeSegmentStyle(), { signal: this.abort.signal })
        this.resetHandles.addEventListener('click', () => this.changeSegment(true), { signal: this.abort.signal })
        this.mountControls()
        const listen = (type, method) => this.svg.addEventListener(type, event => this[method](event), { signal: this.abort.signal })
        listen('pointerdown', 'pointerDown')
        listen('pointermove', 'pointerMove')
        listen('pointerup', 'pointerUp')
        listen('pointercancel', 'pointerCancel')
        listen('lostpointercapture', 'pointerCancel')
        listen('keydown', 'keyDown')
        listen('keyup', 'keyUp')
        listen('blur', 'loseFocus')
        this.svg.addEventListener('wheel', event => this.wheel(event), { passive: false, signal: this.abort.signal })
        window.addEventListener('blur', () => this.loseFocus(), { signal: this.abort.signal })
        const methods = {}
        for (const method of ['open', 'save', 'saveAs', 'undo', 'redo', 'deleteSelected', 'clearSelection', 'zoomIn', 'zoomOut', 'zoomFit']) {
            methods[method] = async input => viewOk(await this.perform(() => this[method](input)))
        }
        for (const [index, tool] of ['draw', 'select', 'insert', 'pan'].entries()) methods[`tool_${index + 1}`] = () => viewOk(this.setTool(tool))
        registerViewPlugin(this, methods)
        const source = this.getAttribute('data-source') || initialSource
        this.render()
        this.resizeObserver.observe(this.svg)
        if (source && source !== this.path) void this.perform(() => this.open(source))
    }

    disconnectedCallback() {
        this.cancelDrag()
        this.abort.abort()
        this.resizeObserver.disconnect()
        for (const group of this.controls) group.remove()
        this.controls = []
        void unregisterViewPlugin(this)
    }

    mountControls() {
        const groups = [
            ['file-actions', [['open', 'Open SVG', 'folder_open'], ['save', 'Save', 'save'], ['saveAs', 'Save as', 'save_as'], ['download', 'Download SVG', 'download']]],
            ['tool-actions', [['draw', 'Draw points', 'edit', 'D'], ['select', 'Select points or segments', 'select_all', 'V'], ['insert', 'Insert point', 'add', 'I'], ['pan', 'Pan', 'pan_tool', 'H'], ['deleteSelected', 'Delete selected points', 'delete'], ['clear', 'Clear track', 'delete_sweep']]],
            ['edit-actions', [['undo', 'Undo', 'undo'], ['redo', 'Redo', 'redo']]],
            ['view-actions', [['zoomIn', 'Zoom in', 'zoom_in'], ['zoomFit', 'Fit track', 'fit_screen'], ['zoomOut', 'Zoom out', 'zoom_out'], ['preview', 'Preview', 'visibility']]],
        ]
        const toolbar = document.createElement('div')
        toolbar.slot = 'header-controls'
        for (const [name, actions] of groups) {
            const group = document.createElement('div')
            group.setAttribute('role', 'buttongroup')
            group.dataset.element = name
            for (const [action, label, symbol, shortcut] of actions) {
                const button = document.createElement('button')
                button.type = 'button'
                button.setAttribute('aria-label', label)
                button.dataset.action = action
                const icon = document.createElement('i')
                icon.setAttribute('aria-hidden', 'true')
                icon.textContent = symbol
                button.append(icon)
                if (action === 'save') button.classList.add('accent')
                if (action === 'deleteSelected' || action === 'clear') button.classList.add('danger')
                button.addEventListener('pointerenter', () => {
                    const rect = button.getBoundingClientRect()
                    void runtime.call('ui.tooltip.tip', { content: shortcut ? `${label} (${shortcut})` : label,
                        anchor: { kind: 'aabb', x: rect.x, y: rect.y, width: rect.width, height: rect.height } }).then(result => unwrap(result))
                }, { signal: this.abort.signal })
                button.addEventListener('click', () => {
                    if (['draw', 'select', 'insert', 'pan'].includes(action)) { this.setTool(action); return }
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
        if (key === 'closed') syncTrackSegments(next)
        try { this.history.commit(next); this.render() }
        catch (error) { field.setCustomValidity(error.message); field.reportValidity(); field.setCustomValidity(''); this.render() }
    }

    changeSegment(reset) {
        if (this.busy || this.preview || !this.selectedSegment) return
        this.cancelDrag()
        const model = this.history.model
        this.history.commit(reset ? resetTrackHandles(model, this.selectedSegment) :
            editTrackSegment(model, this.selectedSegment, this.segmentShape.value))
        this.render()
    }

    changeSegmentStyle() {
        if (this.busy || !this.selectedSegment) return
        this.cancelDrag()
        this.history.commit(setTrackSegmentStyle(this.history.model, this.selectedSegment, this.segmentStyle.value || null))
        this.render()
    }

    selectStyle(id, focus = false) {
        if (this.busy) return
        if (!this.history.model.styles.some(style => style.id === id)) throw new Error('Missing road style')
        this.cancelDrag()
        this.selectedStyle = id
        this.render()
        if (focus) this.styleEditors.get(id).row.focus()
    }

    styleKeyDown(event) {
        const row = event.target.closest('tr[data-style-id]')
        if (!row || this.busy || event.target.closest('button')) return
        const styles = this.history.model.styles
        const index = styles.findIndex(style => style.id === row.dataset.styleId)
        if (index < 0) throw new Error('Missing road style')
        const destinations = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: styles.length - 1, Enter: index, ' ': index }
        if (!Object.hasOwn(destinations, event.key)) return
        event.preventDefault()
        event.stopPropagation()
        const target = Math.max(0, Math.min(styles.length - 1, destinations[event.key]))
        this.selectStyle(styles[target].id, true)
    }

    addStyle() {
        if (this.busy) return
        this.cancelDrag()
        this.history.commit(addTrackStyle(this.history.model))
        this.selectedStyle = this.history.model.styles.at(-1).id
        this.render()
        this.styleName.focus()
    }

    changeStyle(field) {
        if (this.busy || this.selectedStyle === null) return
        this.cancelDrag()
        try {
            this.history.commit(updateTrackStyle(this.history.model, this.selectedStyle, this.styleName.value, this.styleColor.value, this.styleWidth.value === '' ? NaN : Number(this.styleWidth.value)))
        } catch (error) {
            field.setCustomValidity(error.message)
            field.reportValidity()
            field.setCustomValidity('')
            return
        }
        this.render()
    }

    deleteStyle(id, focus = false) {
        if (this.busy) return
        this.cancelDrag()
        const index = this.history.model.styles.findIndex(style => style.id === id)
        this.history.commit(removeTrackStyle(this.history.model, id))
        const styles = this.history.model.styles
        if (this.selectedStyle === id) this.selectedStyle = styles.length ? styles[Math.min(index, styles.length - 1)].id : null
        this.render()
        if (focus) {
            if (this.selectedStyle !== null) this.styleEditors.get(this.selectedStyle).row.focus()
            else this.addStyleButton.focus()
        }
    }

    updateStyleControls(model) {
        if (!model.styles.some(style => style.id === this.selectedStyle)) this.selectedStyle = model.styles.length ? model.styles[0].id : null
        const ids = new Set(model.styles.map(style => style.id))
        for (const [id, editors] of this.styleEditors) if (!ids.has(id)) {
            editors.row.remove()
            this.styleEditors.delete(id)
        }
        const usage = new Map()
        for (const segment of model.segments) if (segment.styleId !== null) usage.set(segment.styleId, (usage.get(segment.styleId) || 0) + 1)
        for (const [index, style] of model.styles.entries()) {
            let editors = this.styleEditors.get(style.id)
            if (!editors) {
                const row = document.createElement('tr')
                row.dataset.styleId = style.id
                const name = document.createElement('td')
                row.append(name)
                const used = document.createElement('td')
                const actions = document.createElement('td')
                const remove = document.createElement('button')
                remove.type = 'button'
                const icon = document.createElement('i')
                icon.setAttribute('aria-hidden', 'true')
                icon.textContent = 'delete'
                remove.append(icon)
                remove.addEventListener('click', event => {
                    event.stopPropagation()
                    this.deleteStyle(style.id, row.contains(document.activeElement))
                }, { signal: this.abort.signal })
                actions.append(remove)
                row.append(used, actions)
                this.styleRows.append(row)
                editors = { row, name, used, remove }
                this.styleEditors.set(style.id, editors)
            }
            if (this.styleRows.children[index] !== editors.row) this.styleRows.insertBefore(editors.row, this.styleRows.children[index] || null)
            const count = usage.get(style.id) || 0
            editors.name.textContent = style.name
            editors.row.setAttribute('aria-selected', String(style.id === this.selectedStyle))
            editors.row.setAttribute('aria-disabled', String(this.busy))
            editors.row.tabIndex = !this.busy && style.id === this.selectedStyle ? 0 : -1
            editors.used.textContent = String(count)
            editors.remove.disabled = this.busy || count > 0
            editors.remove.setAttribute('aria-label', `Delete road style ${style.name}`)
        }
        const selected = model.styles.find(style => style.id === this.selectedStyle)
        this.styleProperties.disabled = this.busy || !selected
        for (const [field, value] of [[this.styleName, selected ? selected.name : ''], [this.styleColor, selected ? selected.roadColor : ''], [this.styleWidth, selected ? selected.roadWidth : '']]) {
            if (field !== document.activeElement || this.busy || this.stylePropertiesId !== this.selectedStyle) field.value = value
        }
        this.stylePropertiesId = this.selectedStyle
        this.addStyleButton.disabled = this.busy || model.styles.length >= 256
        const choices = [['', 'Track default'], ...model.styles.map(style => [style.id, style.name])]
        if (JSON.stringify(choices) !== this.styleChoices) {
            this.segmentStyle.replaceChildren(...choices.map(([value, label]) => {
                const option = document.createElement('option')
                option.value = value
                option.textContent = label
                return option
            }))
            this.styleChoices = JSON.stringify(choices)
        }
    }

    changeHandle(field) {
        if (this.busy || this.preview || !this.selectedSegment) return
        this.cancelDrag()
        const model = this.history.model
        const segment = trackSegments(model).find(segment => segment.id === this.selectedSegment)
        if (!segment || segment.shape !== 'curve') throw new Error('No curved segment selected')
        const position = { ...(field.dataset.handle === 'start' ? segment.c : segment.d) }
        position[field.dataset.axis] = field.value === '' ? NaN : Number(field.value)
        if (!Number.isFinite(position[field.dataset.axis])) {
            field.setCustomValidity('Enter a finite handle coordinate')
            field.reportValidity()
            field.setCustomValidity('')
        } else this.history.commit(moveTrackHandle(model, segment.id, field.dataset.handle, position))
        const updated = trackSegments(this.history.model).find(candidate => candidate.id === segment.id)
        field.value = (field.dataset.handle === 'start' ? updated.c : updated.d)[field.dataset.axis]
        this.render()
    }

    updateSegmentControls(model) {
        const segments = trackSegments(model)
        const segment = segments.find(segment => segment.id === this.selectedSegment)
        if (!segment) this.selectedSegment = null
        const choices = [['', 'No segment selected'], ...segments.map(segment => [segment.id, `Segment ${segment.index + 1}`])]
        // Keep the select mounted while inspector focus changes.
        if (JSON.stringify(choices) !== this.segmentChoices) {
            this.segmentPicker.replaceChildren(...choices.map(([value, label]) => {
                const option = document.createElement('option')
                option.value = value
                option.textContent = label
                return option
            }))
            this.segmentChoices = JSON.stringify(choices)
        }
        this.segmentPicker.value = this.selectedSegment || ''
        this.segmentPicker.disabled = this.busy || this.preview || !segments.length
        this.segmentShape.disabled = this.busy || this.preview || !segment
        this.segmentShape.value = segment ? segment.shape : 'curve'
        const curved = segment && segment.shape === 'curve'
        for (const field of this.handleFields) {
            field.disabled = this.busy || this.preview || !curved
            if (field === document.activeElement && !this.busy) continue
            field.value = curved ? (field.dataset.handle === 'start' ? segment.c : segment.d)[field.dataset.axis] : ''
        }
        const record = model.segments.find(record => record.id === this.selectedSegment)
        this.segmentStyle.disabled = this.busy || !record
        this.segmentStyle.value = record && record.styleId !== null ? record.styleId : ''
        this.resetHandles.disabled = this.busy || this.preview || !curved || record.handles === null
    }

    updateControls() {
        const model = this.drag && this.drag.kind === 'handle' ? this.drag.draft : this.history.model
        this.updateStyleControls(model)
        this.updateSegmentControls(model)
        for (const field of this.fields) {
            field.disabled = this.busy || (this.preview && field.dataset.section !== 'rendering')
            const section = field.dataset.section === 'rendering' ? model.rendering : model.settings
            const value = field.dataset.field === 'name' ? model.name : section[field.dataset.field]
            // Camera/resize renders must not overwrite an inspector edit awaiting change/blur.
            if (field === document.activeElement && !this.busy) continue
            if (field.type === 'checkbox') field.checked = value
            else field.value = value
        }
        for (const group of this.controls) for (const button of group.querySelectorAll('button')) {
            const action = button.dataset.action
            button.disabled = this.busy || (this.preview && ['draw', 'select', 'insert', 'deleteSelected', 'clear'].includes(action)) ||
                (action === 'deleteSelected' && this.selected.size === 0) ||
                (action === 'undo' && !this.history.past.length) || (action === 'redo' && !this.history.future.length)
            if (['draw', 'select', 'insert', 'pan'].includes(action)) {
                button.setAttribute('aria-pressed', String(action === this.tool))
                button.classList.toggle('accent', action === this.tool)
            }
            if (action === 'preview') button.setAttribute('aria-pressed', String(this.preview))
        }
    }

    render() {
        const model = this.drag && ['move', 'handle'].includes(this.drag.kind) ? this.drag.draft : this.history.model
        if (this.path) this.setAttribute('data-source', this.path)
        else this.removeAttribute('data-source')
        const ids = new Set(model.points.map(point => point.id))
        this.selected = new Set([...this.selected].filter(id => ids.has(id)))
        const camera = this.camera
        this.svg.setAttribute('viewBox', `${camera.x} ${camera.y} ${camera.width} ${camera.height}`)
        this.svg.setAttribute('cursor', this.drag && this.drag.kind === 'pan' ? 'grabbing' : this.tool === 'pan' || this.spacePressed ? 'grab' : this.tool === 'select' ? 'default' : 'crosshair')
        const scale = this.screenScale()
        // Only generated, validated values enter this markup; imported SVG never does.
        const grid = []
        if (!this.preview && model.settings.grid) {
            for (let x = 0; x <= model.viewport.width; x += model.settings.gridSize) grid.push(`M ${x} 0 V ${model.viewport.height}`)
            for (let y = 0; y <= model.viewport.height; y += model.settings.gridSize) grid.push(`M 0 ${y} H ${model.viewport.width}`)
        }
        this.svg.innerHTML = `<rect data-element="viewport-background" x="${camera.x}" y="${camera.y}" width="${camera.width}" height="${camera.height}" fill="${this.preview ? '#ffffff' : '#121c28'}"/>
<rect data-element="document-boundary" width="${model.viewport.width}" height="${model.viewport.height}" fill="none" stroke="${this.preview ? '#ffffff' : '#344457'}" stroke-width="${1 / scale}"/>
<path d="${grid.join(' ')}" stroke="#344457" stroke-width="1" fill="none" pointer-events="none"/>
${renderTrack(model, this.centerlineId, this.preview ? '#263b50' : '#91e5ff')}
<g data-element="points"></g>`
        if (!this.preview) {
            this.renderSegmentOverlay(model, scale)
            const layer = this.svg.querySelector('[data-element="points"]')
            model.points.forEach((point, index) => {
                const circle = document.createElementNS(SVG_NS, 'circle')
                for (const [name, value] of Object.entries({ cx: point.x, cy: point.y, r: 9 / scale, fill: this.selected.has(point.id) ? '#ffcf66' : '#ffffff', stroke: '#121c28', 'stroke-width': 3 / scale, 'data-id': point.id, 'aria-label': `Point ${index + 1}` })) circle.setAttribute(name, value)
                layer.append(circle)
            })
        }
        if (this.drag && this.drag.kind === 'box') {
            const { start, end } = this.drag
            const box = document.createElementNS(SVG_NS, 'rect')
            box.dataset.element = 'selection-box'
            for (const [name, value] of Object.entries({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
                width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y), fill: '#91e5ff', 'fill-opacity': 0.12,
                stroke: '#91e5ff', 'stroke-width': 1.5 / scale, 'stroke-dasharray': `${4 / scale} ${4 / scale}`, 'pointer-events': 'none' })) box.setAttribute(name, value)
            this.svg.append(box)
        }
        this.updateControls()
        this.updateStatus()
    }

    renderSegmentOverlay(model, scale) {
        const segment = trackSegments(model).find(segment => segment.id === this.selectedSegment)
        if (!segment) return
        const layer = document.createElementNS(SVG_NS, 'g')
        layer.dataset.element = 'segment-overlay'
        const draw = (tag, attributes) => {
            const element = document.createElementNS(SVG_NS, tag)
            for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
            layer.append(element)
        }
        const { a, b, c, d } = segment
        draw('path', { d: `M ${a.x} ${a.y} ` + (segment.shape === 'curve' ? `C ${c.x} ${c.y} ${d.x} ${d.y} ${b.x} ${b.y}` : `L ${b.x} ${b.y}`),
            fill: 'none', stroke: '#ffcf66', 'stroke-width': 3 / scale, 'pointer-events': 'none', 'data-element': 'segment-highlight' })
        if (segment.shape === 'curve') {
            for (const [handle, endpoint, control] of [['start', a, c], ['end', b, d]]) {
                draw('line', { x1: endpoint.x, y1: endpoint.y, x2: control.x, y2: control.y,
                    stroke: '#ffcf66', 'stroke-width': 1.5 / scale, 'pointer-events': 'none' })
                draw('circle', { cx: control.x, cy: control.y, r: 7 / scale, fill: '#ffcf66', stroke: '#121c28',
                    'stroke-width': 2 / scale, 'data-handle': handle, 'aria-label': `${handle === 'start' ? 'Start' : 'End'} curve handle` })
            }
        }
        // Controls stay above point handles, including coincident curve handles.
        this.svg.append(layer)
    }

    renderViewport() {
        updateTrackViewport(this.svg, this.camera)
        this.updateStatus()
    }

    updateStatus() {
        const model = this.drag && ['move', 'handle'].includes(this.drag.kind) ? this.drag.draft : this.history.model
        const camera = this.camera
        const dirty = JSON.stringify(this.history.model) !== this.saved
        const hints = { draw: 'Click to add · Drag selected points to move', select: 'Click a road segment to edit · Click points or drag a box to select', insert: 'Click a segment to insert a point', pan: 'Drag to pan' }
        this.status.className = ''
        this.status.textContent = `${dirty ? 'Unsaved · ' : ''}${this.path || 'New blueprint'} · ${model.points.length} points · ${this.selected.size} points selected${this.selectedSegment ? ` · Segment ${model.segments.findIndex(segment => segment.id === this.selectedSegment) + 1}` : ''} · ${Math.round(model.viewport.width / camera.width * 100)}% · ${this.preview ? 'Preview' : hints[this.tool]}`
    }

    screenScale() {
        const matrix = this.svg.getScreenCTM()
        if (!matrix || matrix.a <= 0) throw new Error('Track SVG has no screen transform')
        return matrix.a
    }

    canvasPoint(event) {
        const matrix = this.svg.getScreenCTM()
        if (!matrix) throw new Error('Track SVG has no screen transform')
        return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    }

    setTool(tool) {
        if (!['draw', 'select', 'insert', 'pan'].includes(tool)) throw new Error(`Unknown track tool: ${tool}`)
        if (this.busy || (this.preview && tool !== 'pan')) return false
        this.cancelDrag()
        this.tool = tool
        this.render()
        return true
    }

    resetCamera() {
        this.camera = fitTrackCamera([], this.history.model.viewport)
    }

    zoomAt(anchor, factor) {
        if (this.drag) { this.cancelDrag(); this.render() }
        this.camera = zoomTrackCamera(this.camera, this.history.model.viewport, anchor, factor)
        this.renderViewport()
    }
    zoomIn() { this.zoomAt({ x: this.camera.x + this.camera.width / 2, y: this.camera.y + this.camera.height / 2 }, 1.2) }
    zoomOut() { this.zoomAt({ x: this.camera.x + this.camera.width / 2, y: this.camera.y + this.camera.height / 2 }, 0.8) }
    zoomFit() {
        this.cancelDrag()
        const model = this.history.model
        const bounds = [...model.points, ...trackSegments(model).flatMap(segment => [segment.c, segment.d])]
        const style = model.rendering
        const width = trackRoadWidths(model).reduce((maximum, profile) => Math.max(maximum, profile.width), 0) || style.roadWidth
        const stroke = style.mode === 'road' ? width + 2 * (style.edgeWidth + style.outlineWidth) : 12
        this.camera = fitTrackCamera(bounds, model.viewport, 40 + stroke / 2)
        this.render()
    }

    wheel(event) {
        event.preventDefault()
        if (this.busy || this.drag) return
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.svg.getBoundingClientRect().height : 1
        if ((event.ctrlKey || event.metaKey) && event.deltaY !== 0) {
            this.zoomAt(this.canvasPoint(event), trackWheelZoomFactor(event.deltaY, event.deltaMode, this.svg.getBoundingClientRect().height))
        } else {
            const scale = this.screenScale()
            this.camera.x += event.deltaX * unit / scale
            this.camera.y += event.deltaY * unit / scale
            this.renderViewport()
        }
    }

    pointerDown(event) {
        if (this.busy || this.drag || ![0, 1].includes(event.button)) return
        const pan = event.button === 1 || this.tool === 'pan' || this.spacePressed
        if (this.preview && !pan) return
        event.preventDefault()
        this.svg.focus()
        const position = this.canvasPoint(event)
        const model = this.history.model
        if (pan) {
            this.drag = { kind: 'pan', pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
                camera: { ...this.camera }, scale: this.screenScale(), temporary: this.spacePressed && this.tool !== 'pan' }
        } else {
            const id = event.target.getAttribute('data-id')
            const handle = event.target.getAttribute('data-handle')
            const beforeSegment = this.selectedSegment
            const beforeSelection = new Set(this.selected)
            if (handle) {
                if (!this.selectedSegment) throw new Error('Curve handle has no selected segment')
                this.drag = { kind: 'handle', pointerId: event.pointerId, start: position, scale: this.screenScale(),
                    handle, segmentId: this.selectedSegment, draft: structuredClone(model), beforeSelection, beforeSegment, moved: false }
            } else if (id) {
                this.selectedSegment = null
                if (event.shiftKey) {
                    if (this.selected.has(id)) { this.selected.delete(id); this.render(); return }
                    this.selected.add(id)
                } else if (!this.selected.has(id)) this.selected = new Set([id])
                this.drag = { kind: 'move', pointerId: event.pointerId, start: position, scale: this.screenScale(),
                    draft: structuredClone(model), ids: new Set(this.selected), beforeSelection, beforeSegment, moved: false }
            } else if (this.tool === 'select') {
                const hit = nearestSegment(model, position)
                if (hit && hit.distance * this.screenScale() <= 20) {
                    this.selected.clear()
                    this.selectedSegment = model.segments[hit.index].id
                    this.render()
                    return
                }
                this.selectedSegment = null
                const base = event.shiftKey ? new Set(this.selected) : new Set()
                this.selected = new Set(base)
                this.drag = { kind: 'box', pointerId: event.pointerId, start: position, end: position, base, beforeSelection, beforeSegment }
            } else {
                if (position.x < 0 || position.y < 0 || position.x > model.viewport.width || position.y > model.viewport.height) return
                let next = structuredClone(model)
                let insertion = null
                let index = next.points.length
                let point = position
                if (this.tool === 'insert') {
                    const hit = nearestSegment(model, position, true)
                    if (!hit || hit.distance * this.screenScale() > 20) return
                    index = hit.index + 1
                    insertion = hit
                    point = segmentPoint(trackSegments(model)[hit.index], hit.t)
                }
                const added = { id: crypto.randomUUID(), ...placePoint(model, point.x, point.y) }
                if (insertion) next = insertTrackPoint(model, insertion.index, added, insertion.t)
                else { next.points.splice(index, 0, added); syncTrackSegments(next) }
                this.selectedSegment = null
                this.selected = new Set([added.id])
                this.history.commit(next)
                this.render()
                return
            }
        }
        this.svg.setPointerCapture(event.pointerId)
        this.render()
    }

    pointerMove(event) {
        if (!this.drag || event.pointerId !== this.drag.pointerId) return
        const drag = this.drag
        if (drag.kind === 'pan') {
            this.camera = { ...drag.camera, x: drag.camera.x - (event.clientX - drag.clientX) / drag.scale,
                y: drag.camera.y - (event.clientY - drag.clientY) / drag.scale }
        } else {
            const position = this.canvasPoint(event)
            if (drag.kind === 'box') {
                drag.end = position
                this.selected = pointsInBox(this.history.model.points, drag.start, position, drag.base)
            } else {
                const delta = { x: position.x - drag.start.x, y: position.y - drag.start.y }
                if (!drag.moved && Math.hypot(delta.x, delta.y) * drag.scale < 2) return
                drag.moved = true
                // Every event translates the original points, not the previous frame's snapped draft.
                drag.draft = drag.kind === 'handle' ? moveTrackHandle(this.history.model, drag.segmentId, drag.handle, position) :
                    moveTrackSelection(this.history.model, drag.ids, delta)
            }
        }
        this.render()
    }

    releaseDrag() {
        const drag = this.drag
        this.drag = null
        if (drag && this.svg.hasPointerCapture(drag.pointerId)) this.svg.releasePointerCapture(drag.pointerId)
        return drag
    }

    pointerUp(event) {
        if (!this.drag || event.pointerId !== this.drag.pointerId) return
        this.pointerMove(event)
        const drag = this.releaseDrag()
        if (['move', 'handle'].includes(drag.kind)) this.history.commit(drag.draft)
        this.render()
    }

    pointerCancel(event) {
        if (this.drag && event.pointerId === this.drag.pointerId) { this.cancelDrag(); this.render() }
    }

    cancelDrag() {
        const drag = this.releaseDrag()
        if (!drag) return
        if (drag.kind === 'pan') this.camera = drag.camera
        else { this.selected = drag.beforeSelection; this.selectedSegment = drag.beforeSegment }
    }

    loseFocus() {
        this.spacePressed = false
        this.cancelDrag()
        this.render()
    }

    keyUp(event) {
        if (event.key !== ' ') return
        event.preventDefault()
        this.spacePressed = false
        if (this.drag && this.drag.kind === 'pan' && this.drag.temporary) this.releaseDrag()
        this.render()
    }

    keyDown(event) {
        if (this.busy) return
        const mod = event.ctrlKey || event.metaKey
        const key = event.key.toLowerCase()
        if (event.key === ' ') {
            event.preventDefault()
            this.spacePressed = true
            this.render()
        } else if (mod && ['z', 'y', 's'].includes(key)) {
            event.preventDefault()
            void this.perform(() => key === 's' ? this.save() : key === 'y' || event.shiftKey ? this.redo() : this.undo())
        } else if (mod && key === 'a' && !this.preview) {
            event.preventDefault()
            this.cancelDrag()
            this.selectedSegment = null
            this.selected = new Set(this.history.model.points.map(point => point.id))
            this.render()
        } else if (!mod && !event.altKey && ['d', 'v', 'i', 'h'].includes(key)) {
            event.preventDefault()
            this.setTool({ d: 'draw', v: 'select', i: 'insert', h: 'pan' }[key])
        } else if (!this.preview && ['Delete', 'Backspace'].includes(event.key)) {
            event.preventDefault(); this.deleteSelected()
        } else if (event.key === 'Escape') {
            if (this.drag) this.cancelDrag()
            else { this.selected.clear(); this.selectedSegment = null }
            this.spacePressed = false
            this.render()
        }
    }

    clearSelection() { this.cancelDrag(); this.selected.clear(); this.selectedSegment = null; this.render() }
    deleteSelected() {
        if (this.preview) return
        this.cancelDrag()
        const next = structuredClone(this.history.model)
        next.points = next.points.filter(point => !this.selected.has(point.id))
        syncTrackSegments(next)
        this.history.commit(next)
        this.selected.clear()
        this.render()
    }
    clear() {
        if (this.preview) return
        this.cancelDrag()
        const next = structuredClone(this.history.model)
        next.points = []
        next.segments = []
        next.annotations = []
        this.history.commit(next)
        this.selected.clear()
        this.resetCamera()
        this.render()
    }
    undo() {
        this.cancelDrag()
        const context = this.history.context
        this.history.undo()
        if (context !== this.history.context) this.resetCamera()
        this.render()
    }
    redo() {
        this.cancelDrag()
        const context = this.history.context
        this.history.redo()
        if (context !== this.history.context) this.resetCamera()
        this.render()
    }

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
        this.selected.clear()
        this.selectedSegment = null
        this.zoomFit()
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
