import './icons.js'
import { bindTheme, downloadFile, limit, renderDiagram } from './diagram.js'
import { bindViewport } from './viewport.js'
import { readAnnotations, withAnnotations } from './annotations.js'
import { readDraft, saveDraft } from './draft.js'
import { examples } from './examples.js'
import { attachInspector } from './inspect.js'

const $ = id => document.getElementById(id)
const editor = $('source')
const drawing = $('drawing')
const viewport = $('viewport')
let busy = false
let pendingRender
let renderedSource = ''
let rawSvg = ''
let annotations
let inspector
const view = bindViewport(() => inspector?.clear())
let copyTimer
function status(value, ok = false) {
  $('state').textContent = value
  $('state').classList.toggle('ok', ok)
}
function escapeHtml(s) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
let draftTimer
function flushDraft() {
  if (draftTimer == null) return
  clearTimeout(draftTimer)
  draftTimer = null
  $('save-warning').hidden = saveDraft($('filename').textContent, editor.value)
}
function scheduleSave() {
  clearTimeout(draftTimer)
  draftTimer = setTimeout(flushDraft, 250)
}
window.addEventListener('pagehide', flushDraft)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushDraft()
})

function refreshEditor() {
  const value = editor.value
  const count = value.split('\n').length
  $('lines').textContent = count.toLocaleString() + (count === 1 ? ' line' : ' lines')
  $('gutter').textContent = Array.from({length: count}, (_, i) => i + 1).join('\n')
  if (value.length < 100000) {
    const tokens = /%%[^\n]*|\b(?:flowchart|sequenceDiagram|class|participant|TD|LR|TB|graph|classDef)\b|-->|->>|-->>|\[[^\]\n]*\]|\|[^|\n]*\|/g
    let html = '', last = 0
    for (const match of value.matchAll(tokens)) {
      const token = match[0]
      const type = token.startsWith('%%') ? 'comment' : /^[-]/.test(token) ? 'arrow' : /^[\[|]/.test(token) ? 'label' : 'keyword'
      html += escapeHtml(value.slice(last, match.index)) + '<span class="' + type + '">' + escapeHtml(token) + '</span>'
      last = match.index + token.length
    }
    $('highlight').innerHTML = html + escapeHtml(value.slice(last)) + '\n'
  } else $('highlight').textContent = value + '\n'
  syncScroll()
  updateAnnotationAccess()
  status(value === renderedSource && rawSvg ? 'Rendered' : 'Edited', value === renderedSource && !!rawSvg)
}
function syncScroll() {
  $('highlight').scrollTop = $('gutter').scrollTop = editor.scrollTop
  $('highlight').scrollLeft = editor.scrollLeft
}
function updateAnnotationAccess() {
  const locked = busy || editor.value !== renderedSource
  $('references').disabled = $('notes').disabled = locked
  $('annotation-status').textContent = locked ? 'Render your source edits to annotate this node.' : 'Included in the Mermaid source.'
}

function focusNeighborhood(node, neighbors, id) {
  $('node-tools').hidden = !node
  const record = annotations?.records.get(id)
  $('references').value = record?.references ?? ''
  $('notes').value = record?.notes ?? ''
  updateAnnotationAccess()
  view.focus(node, neighbors)
}
async function render(source = editor.value, previousView = null) {
  if (busy) {
    pendingRender = { source, previousView }
    return
  }
  busy = true
  updateAnnotationAccess()
  $('theme-switch').disabled = true
  $('render').disabled = true
  $('notice').hidden = true
  status('Rendering')
  try {
    if (!source.trim()) throw Error('Enter Mermaid code to render a diagram.')
    if (source.length > limit) throw Error('Diagram exceeds the 2 million character limit.')
    annotations = readAnnotations(source)
    const { svg, layout } = await renderDiagram(annotations.diagram)
    drawing.innerHTML = svg
    rawSvg = svg
    renderedSource = source
    inspector = attachInspector(drawing.firstElementChild, layout, $('hint'), focusNeighborhood)
    focusNeighborhood(null, [])
    inspector.setMode($('trace-mode').value)
    if (previousView) {
      inspector.restore(previousView.selected)
      view.setZoom(previousView.zoom)
      viewport.scrollTo(previousView.left, previousView.top)
    }
    status(source === editor.value ? 'Rendered' : 'Edited', source === editor.value)
    $('export').disabled = false
  } catch (error) {
    drawing.replaceChildren()
    focusNeighborhood(null, [])
    rawSvg = ''
    inspector = null
    $('export').disabled = true
    $('notice').textContent = (error.message || String(error)).slice(0, 1800)
    $('notice').hidden = false
    $('hint').textContent = 'Edit the source and render again'
    status('Render error')
  } finally {
    $('theme-switch').disabled = false
    $('render').disabled = busy = false
    updateAnnotationAccess()
    if (pendingRender) {
      const next = pendingRender
      pendingRender = null
      render(next.source, next.previousView)
    }
  }
}
$('trace-mode').onchange = () => inspector?.setMode($('trace-mode').value)
function updateAnnotation() {
  const id = inspector?.selected
  if (id == null || busy || editor.value !== renderedSource) return
  const references = $('references').value
  const notes = $('notes').value
  const previous = annotations.records.get(id)
  if (references || notes) annotations.records.set(id, { references, notes })
  else annotations.records.delete(id)
  const source = withAnnotations(annotations.diagram, annotations.records)
  if (source.length > limit) {
    if (previous) annotations.records.set(id, previous)
    else annotations.records.delete(id)
    $('references').value = previous?.references ?? ''
    $('notes').value = previous?.notes ?? ''
    $('annotation-status').textContent = 'The diagram has reached its 2 million character limit.'
    return
  }
  editor.value = renderedSource = source
  scheduleSave()
  refreshEditor()
}
$('references').oninput = $('notes').oninput = updateAnnotation
function closeMenu() {
  $('menu').hidden = true
  $('examples').setAttribute('aria-expanded', 'false')
}
function load(example) {
  editor.value = example.source
  $('filename').textContent = example.file
  editor.scrollTop = editor.scrollLeft = 0
  refreshEditor()
  if (editor.value.trimStart().startsWith('{')) {
    status('JSON draft')
    $('hint').textContent = 'Choose Render to open this assessment.'
  } else render()
}
async function openAssessment(text, filename) {
  const { importAssessmentText, assessmentURL } = await import('./assessment-import.js')
  const run = await importAssessmentText(text, filename)
  location.assign(assessmentURL(run))
}

function importError(error) {
  $('import-error').textContent = error.message
  $('import-error').hidden = false
}

$('open-graph').onclick = () => $('graph-file').click()
$('graph-file').onchange = async event => {
  const [file] = event.target.files
  event.target.value = ''
  if (!file) return
  $('import-error').hidden = true
  try {
    if (/\.json$/i.test(file.name)) {
      status('Indexing assessment…')
      const { importFiles, assessmentURL } = await import('./assessment-import.js')
      location.assign(assessmentURL(await importFiles([file])))
      return
    }
    const text = await file.text()
    if (text.trimStart().startsWith('{')) {
      await openAssessment(text, file.name.replace(/\.json$/i, ''))
    } else {
      if (text.length > limit) throw Error('Mermaid source exceeds the 2 million character limit.')
      load({ file: file.name, source: text })
      scheduleSave()
    }
  } catch (error) {
    status('Import failed')
    importError(error.message.startsWith(file.name + ': ') ? error : new Error(file.name + ': ' + error.message))
  }
}

function renderEditor() {
  $('import-error').hidden = true
  if (editor.value.trimStart().startsWith('{')) openAssessment(editor.value, 'graph').catch(importError)
  else render()
}

for (const example of examples) {
  const btn = document.createElement('button')
  btn.textContent = example.name
  btn.onclick = () => {
    if (busy) return
    closeMenu()
    load(example)
    scheduleSave()
    $('examples').focus()
  }
  $('menu').append(btn)
}
$('examples').onclick = () => {
  const open = $('menu').hidden
  $('menu').hidden = !open
  $('examples').setAttribute('aria-expanded', String(open))
  if (open) $('menu').firstElementChild.focus()
}
document.addEventListener('click', event => { if (!event.target.closest('.examples')) closeMenu() })
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (!$('menu').hidden) $('examples').focus()
    closeMenu()
    inspector?.clear()
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    renderEditor()
  }
})
$('shortcut').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ ↵' : 'Ctrl ↵'
editor.addEventListener('input', () => {
  refreshEditor()
  scheduleSave()
})
editor.addEventListener('scroll', syncScroll)
$('render').onclick = renderEditor
bindTheme(() => {
  if (rawSvg) render(renderedSource, {
    selected: inspector?.selected, zoom: view.zoom, left: viewport.scrollLeft, top: viewport.scrollTop
  })
})
$('toggle-source').onclick = () => {
  const hidden = !$('source-panel').hidden
  $('source-panel').hidden = hidden
  $('workspace').classList.toggle('source-hidden', hidden)
  $('toggle-source').setAttribute('aria-expanded', String(!hidden))
  $('toggle-source').querySelector('span').textContent = hidden ? 'Show source' : 'Hide source'
  view.resize()
  if (!hidden) syncScroll()
}
$('copy').onclick = async () => {
  const button = $('copy')
  try {
    await navigator.clipboard.writeText(editor.value)
    button.textContent = 'Copied'
  } catch {
    editor.focus()
    editor.select()
    button.textContent = 'Source selected'
  }
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => button.replaceChildren(copyIcon.cloneNode(true)), 1400)
}
const copyIcon = $('copy').firstElementChild.cloneNode(true)
$('export').onclick = () => {
  const filename = $('filename').textContent.replace(/\.[^.]+$/, '') + '.svg'
  downloadFile(filename, rawSvg, 'image/svg+xml')
}
load(readDraft() ?? examples[0])
