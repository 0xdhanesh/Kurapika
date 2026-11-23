import './icons.js'
import mermaid from './vendor/mermaid.esm.min.mjs'
import { examples } from './examples.js'
import { attachInspector } from './inspect.js'

const $ = id => document.getElementById(id)
const editor = $('source')
const drawing = $('drawing')
const viewport = $('viewport')
const limit = 2_000_000
function configureTheme() {
  const dark = document.documentElement.dataset.theme === 'dark'
  const colors = dark ? {
    darkMode: true, background: '#101515', primaryColor: '#24312e',
    primaryBorderColor: '#719184', primaryTextColor: '#e2ebe6',
    secondaryColor: '#2c3939', tertiaryColor: '#303736',
    textColor: '#e2ebe6', lineColor: '#98aca3', edgeLabelBackground: '#202825',
    clusterBkg: '#353b3a', clusterBorder: '#78837f'
  } : {
    primaryColor: '#f0ecff', primaryBorderColor: '#9884cf', primaryTextColor: '#302449',
    lineColor: '#8b8c9f', edgeLabelBackground: '#fdfdfe', background: '#ffffff'
  }
  const shapeStyles = dark
    ? '.entry .label-container{fill:#263931;stroke:#79a48c}.service .label-container{fill:#24343a;stroke:#749ba6}.storage .label-container{fill:#363329;stroke:#a49b75}.cluster rect{fill:rgba(220,227,224,.12)!important;stroke:#74827b}'
    : '.entry .label-container{fill:#ece6ff;stroke:#9981d2}.service .label-container{fill:#e7f3f2;stroke:#77aba7}.storage .label-container{fill:#fff2da;stroke:#c5a46e}'
  mermaid.initialize({
    startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
    maxTextSize: limit, maxEdges: 10000, htmlLabels: false, theme: 'base',
    themeVariables: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: '16px', ...colors },
    themeCSS: shapeStyles + '.node rect.label-container{rx:7px;ry:7px}.edgeLabel{font-size:13px}',
    flowchart: { curve: 'basis', rankSpacing: 42, nodeSpacing: 56, padding: 18 }
  })
  $('theme-switch').setAttribute('aria-pressed', String(dark))
  $('theme-switch').title = dark ? 'Switch to light theme' : 'Switch to dark theme'
}
configureTheme()
let busy = false
let renderedSource = ''
let rawSvg = ''
let zoom = 1
let focusRegion = null
let inspector
let copyTimer
function status(value, ok = false) {
  $('state').textContent = value
  $('state').classList.toggle('ok', ok)
}
function escapeHtml(s) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
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
  status(value === renderedSource && rawSvg ? 'Rendered' : 'Edited', value === renderedSource && !!rawSvg)
}
function syncScroll() {
  $('highlight').scrollTop = $('gutter').scrollTop = editor.scrollTop
  $('highlight').scrollLeft = editor.scrollLeft
}
function resize() {
  const svg = drawing.firstElementChild
  if (!svg) return
  const box = svg.viewBox.baseVal
  const width = Math.max(1, viewport.clientWidth - 54)
  const height = Math.max(1, viewport.clientHeight - 87)
  const overviewScale = Math.min(width / box.width, height / box.height, 1.65)
  let scale = overviewScale
  if (focusRegion) {
    const { radiusX, radiusY, nodeWidth, nodeHeight } = focusRegion
    const neighborhoodScale = Math.min(width / (2 * radiusX), height / (2 * radiusY))
    // A distant neighbor must not shrink the selected label to a few pixels.
    const readableScale = Math.min(1.2, width / nodeWidth, height / nodeHeight)
    scale = Math.min(2, Math.max(readableScale, neighborhoodScale))
    // Extra scroll space lets even the first or last node sit at the center.
    drawing.style.padding = viewport.clientHeight / 2 + 'px ' + viewport.clientWidth / 2 + 'px'
  } else {
    drawing.style.padding = ''
  }
  scale *= zoom
  svg.style.width = Math.max(1, box.width * scale) + 'px'
  svg.style.height = Math.max(1, box.height * scale) + 'px'
  $('scale').value = Math.round(scale / overviewScale * 100) + '%'
  if (focusRegion) {
    const rect = svg.getBoundingClientRect()
    const frame = viewport.getBoundingClientRect()
    viewport.scrollLeft += rect.left + rect.width * focusRegion.x - frame.left - viewport.clientWidth / 2
    viewport.scrollTop += rect.top + rect.height * focusRegion.y - frame.top - viewport.clientHeight / 2
  }
}
function setZoom(value) {
  zoom = Math.max(.25, Math.min(32, value))
  resize()
}
function focusNeighborhood(node, neighbors) {
  focusRegion = null
  if (node) {
    // Screen bounds include every nested Mermaid group transform.
    const svg = drawing.firstElementChild
    const rect = svg.getBoundingClientRect()
    const units = svg.viewBox.baseVal.width / rect.width
    const target = node.getBoundingClientRect()
    const cx = target.left + target.width / 2
    const cy = target.top + target.height / 2
    let radiusX = 1
    let radiusY = 1
    for (const neighbor of neighbors) {
      const bounds = neighbor.getBoundingClientRect()
      radiusX = Math.max(radiusX, cx - bounds.left, bounds.right - cx)
      radiusY = Math.max(radiusY, cy - bounds.top, bounds.bottom - cy)
    }
    focusRegion = {
      x: (cx - rect.left) / rect.width,
      y: (cy - rect.top) / rect.height,
      nodeWidth: Math.max(1, target.width * units),
      nodeHeight: Math.max(1, target.height * units),
      radiusX: radiusX * units, radiusY: radiusY * units
    }
  }
  $('overview').hidden = !node
  setZoom(1)
}
async function render(source = editor.value, previousView = null) {
  if (busy) return
  busy = true
  $('theme-switch').disabled = true
  $('render').disabled = true
  $('notice').hidden = true
  status('Rendering')
  try {
    if (!source.trim()) throw Error('Enter Mermaid code to render a diagram.')
    if (source.length > limit) throw Error('Diagram exceeds the 2 million character limit.')
    const { svg } = await mermaid.render('mermaid-preview', source)
    const parsed = await mermaid.mermaidAPI.getDiagramFromText(source)
    const layout = parsed.db.getData?.()
    drawing.innerHTML = svg
    rawSvg = svg
    renderedSource = source
    inspector = attachInspector(drawing.firstElementChild, layout, $('hint'), focusNeighborhood)
    focusNeighborhood(null, [])
    if (previousView) {
      inspector.restore(previousView.selected)
      setZoom(previousView.zoom)
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
  }
}
function closeMenu() {
  $('menu').hidden = true
  $('examples').setAttribute('aria-expanded', 'false')
}
function load(example) {
  editor.value = example.source
  $('filename').textContent = example.file
  editor.scrollTop = editor.scrollLeft = 0
  refreshEditor()
  render()
}
for (const example of examples) {
  const btn = document.createElement('button')
  btn.textContent = example.name
  btn.onclick = () => {
    if (busy) return
    closeMenu()
    load(example)
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
    render()
  }
})
$('shortcut').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ ↵' : 'Ctrl ↵'
editor.addEventListener('input', refreshEditor)
editor.addEventListener('scroll', syncScroll)
$('render').onclick = () => render()
viewport.onclick = () => inspector?.clear()
$('plus').onclick = () => setZoom(zoom * 1.25)
$('minus').onclick = () => setZoom(zoom / 1.25)
$('fit').onclick = () => {
  inspector?.clear()
  setZoom(1)
}
$('theme-switch').onclick = () => {
  const root = document.documentElement
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'
  try { localStorage.setItem('kurapika-theme', root.dataset.theme) } catch { /* Session-only preference. */ }
  configureTheme()
  if (rawSvg) render(renderedSource, {
    selected: inspector?.selected, zoom, left: viewport.scrollLeft, top: viewport.scrollTop
  })
}
$('overview').onclick = () => inspector?.clear()
$('toggle-source').onclick = () => {
  const hidden = !$('source-panel').hidden
  $('source-panel').hidden = hidden
  $('workspace').classList.toggle('source-hidden', hidden)
  $('toggle-source').setAttribute('aria-expanded', String(!hidden))
  $('toggle-source').querySelector('span').textContent = hidden ? 'Show source' : 'Hide source'
  resize()
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
  const url = URL.createObjectURL(new Blob([rawSvg], {type:'image/svg+xml'}))
  const link = document.createElement('a')
  link.href = url
  link.download = $('filename').textContent.replace(/\.mmd$/, '.svg')
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
new ResizeObserver(resize).observe(viewport.parentElement)
load(examples[0])
