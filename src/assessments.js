import './icons.js'
import { bindTheme, downloadFile, renderDiagram } from './diagram.js'
import { bindViewport } from './viewport.js'
import { attachInspector } from './inspect.js'
import { snapshotAt } from './assessment-format.js'
import { exportMermaid, filterGraph, toMermaid } from './assessment-graph.js'
import { getRun, listReviews, listRuns } from './assessment-store.js'
import { assessmentURL, importAssessmentText, importFiles } from './assessment-import.js'
import { inspectSubject } from './assessment-inspector.js'
import { bindReviews } from './assessment-review.js'
import { $, countLabel, options, showComparison, showCoverage } from './assessment-ui.js'

let library = []
let run, graph, baseline
let selection = null
let step = 0
let scopeVersion = 0
let comparisonVersion = 0
let renderVersion = 0
let playbackVersion = 0
let renderQueue = Promise.resolve()
let view, compiled, inspector
let svg = ''
let syncingFocus = false
const reviews = bindReviews()
const camera = bindViewport(() => choose(null))
const facets = ['file', 'language', 'status', 'agent', 'type']

function errorNotice(error) {
  $('import-error').textContent = error.message || String(error)
  $('import-error').hidden = false
}

function filters() {
  const values = { symbol: $('filter-symbol').value, unresolved: $('filter-unresolved').checked, isolate: $('filter-isolate').checked }
  for (const key of facets) values[key] = $('filter-' + key).value
  return values
}

function clearFilters() {
  for (const key of ['symbol', ...facets]) $('filter-' + key).value = ''
  $('filter-isolate').checked = $('filter-unresolved').checked = false
}

function updateFacets() {
  const nodes = [...graph.nodes.values()]
  const edges = [...graph.relationships.values()]
  const subjects = [...nodes, ...graph.chains.values()]
  const agents = subjects.flatMap(item => [item.agent, ...item.validations.map(v => v.agent)])
  const values = {
    file: nodes.flatMap(n => n.locations.map(loc => loc.file)),
    language: nodes.map(n => n.language), status: nodes.map(n => n.status), type: edges.map(e => e.type),
    agent: agents.concat(edges.map(e => e.agent))
  }
  for (const key of facets) {
    const input = $('filter-' + key)
    const choices = new Set([...values[key], input.value].filter(Boolean))
    options(input, [...choices].sort(), 'All')
  }
}

function populateSubjects() {
  const select = $('subject')
  select.replaceChildren(new Option('Choose a node or chain', ''))
  for (const table of ['nodes', 'chains']) {
    const group = document.createElement('optgroup')
    group.label = table === 'nodes' ? 'Nodes' : 'Chains'
    for (const row of graph[table].values()) {
      group.append(new Option(row.symbol + (row.symbol === row.id ? '' : ' · ' + row.id), JSON.stringify([table, row.id])))
    }
    if (group.children.length) select.append(group)
  }
}

function showSubject() {
  $('filter-isolate').disabled = !selection
  $('inspect-empty').hidden = Boolean(selection)
  $('subject-details').hidden = !selection
  $('subject').value = selection ? JSON.stringify([selection.table, selection.id]) : ''
  if (selection) inspectSubject(graph, selection, graph.evidence, choose)
  reviews.select(selection, run.runId, step)
}

function syncFocus() {
  if (!inspector) return
  syncingFocus = true
  try {
    const alias = selection?.table === 'nodes' ? compiled.aliases.get(selection.id) : null
    $('trace-mode').disabled = !alias
    if (alias && inspector.selected !== alias) inspector.restore(alias)
    if (!alias) inspector.clear()
    const chain = selection?.table === 'chains' && graph.chains.get(selection.id)
    const members = new Set(chain ? chain.members.map(id => compiled.aliases.get(id)) : [])
    for (const node of $('drawing').querySelectorAll('[data-inspect-id]')) {
      node.classList.toggle('chain-member', members.has(node.dataset.inspectId))
    }
    if (chain) $('hint').textContent = chain.symbol + ' · ' + countLabel(chain.members.length, 'chain member')
    else if (selection && !alias) $('hint').textContent = 'The selected node is outside the current filters.'
    else if (!selection) $('hint').textContent = 'Select a node to inspect its connections'
    $('overview').hidden = !selection
  } finally { syncingFocus = false }
}

function choose(next) {
  if (!graph || (next && !graph[next.table].has(next.id))) return
  if (selection?.id === next?.id && selection?.table === next?.table) return
  const isolated = $('filter-isolate').checked
  selection = next
  if (!selection) $('filter-isolate').checked = false
  showSubject()
  if (isolated) drawGraph()
  else syncFocus()
}

function drawGraph() {
  const version = ++renderVersion
  view = filterGraph(graph, filters(), selection)
  compiled = toMermaid(view)
  inspector = null
  svg = ''
  $('drawing').replaceChildren()
  camera.focus(null, [])
  $('trace-mode').disabled = $('export-svg').disabled = true
  $('export-mmd').disabled = !view.nodes.length
  $('graph-count').textContent = countLabel(view.nodes.length, 'node') + ' · ' + countLabel(view.edges.length, 'relationship')
  $('notice').hidden = Boolean(view.nodes.length)
  $('notice').textContent = 'No nodes match this view.'
  $('hint').textContent = view.nodes.length ? 'Rendering graph…' : 'Adjust the filters or timeline position.'
  if (!view.nodes.length) return Promise.resolve()
  // Serialize Mermaid renders, discarding stale results after a filter or timeline change.
  renderQueue = renderQueue.then(async () => {
    if (version !== renderVersion) return
    try {
      const result = await renderDiagram(compiled.diagram)
      if (version !== renderVersion) return
      svg = result.svg
      $('drawing').innerHTML = svg
      inspector = attachInspector($('drawing').firstElementChild, result.layout, $('hint'), (node, neighbors, alias) => {
        if (version !== renderVersion) return
        camera.focus(node, neighbors)
        if (!syncingFocus) choose(alias ? { table: 'nodes', id: compiled.originalIds.get(alias) } : null)
      }, alias => compiled.originalIds.has(alias))
      inspector.setMode($('trace-mode').value)
      camera.resize()
      syncFocus()
      $('export-svg').disabled = false
    } catch (error) {
      if (version !== renderVersion) return
      $('notice').textContent = error.message
      $('notice').hidden = false
      $('hint').textContent = 'Graph could not be rendered.'
    }
  })
  return renderQueue
}

function stopPlayback() {
  ++playbackVersion
  $('play').textContent = 'Play'
  $('play').setAttribute('aria-pressed', 'false')
}

function updateComparison() {
  showCoverage(graph, baseline, $('coverage-kind').value)
  showComparison(graph, baseline, $('baseline').value, choose)
}

function setStep(value) {
  step = value
  graph = snapshotAt(run, step)
  if (selection && !graph[selection.table].has(selection.id)) {
    selection = null
    $('filter-isolate').checked = false
  }
  const count = run.events.length
  $('step').max = count
  $('step').value = step
  $('step').disabled = $('play').disabled = !count
  $('previous-step').disabled = step === 0
  $('next-step').disabled = step === count
  $('step-count').textContent = 'Step ' + step + ' of ' + count
  const event = run.events[step - 1]
  $('event-summary').textContent = event
    ? [event.at, event.agent, event.summary || 'Graph updated'].filter(Boolean).join(' · ')
    : (count ? 'Initial graph' : 'Imported snapshot · no replay events')
  updateFacets()
  populateSubjects()
  showSubject()
  updateComparison()
  return drawGraph()
}

async function play() {
  if ($('play').getAttribute('aria-pressed') === 'true') { stopPlayback(); return }
  const version = ++playbackVersion
  $('play').setAttribute('aria-pressed', 'true')
  $('play').textContent = 'Pause'
  if (step === run.events.length) await setStep(0)
  while (version === playbackVersion && step < run.events.length) {
    await new Promise(resolve => setTimeout(resolve, 950))
    if (version !== playbackVersion) return
    await setStep(step + 1)
  }
  if (version === playbackVersion) stopPlayback()
}

async function openRun(repository, runId) {
  const version = ++scopeVersion
  ++comparisonVersion
  stopPlayback()
  const ordered = library.filter(item => item.repository === repository)
  const index = Math.max(0, ordered.findIndex(item => item.runId === runId))
  const active = ordered[index]
  const older = ordered.slice(index + 1)
  const previousId = older[0]?.runId
  const [current, previous, records] = await Promise.all([
    getRun(repository, active.runId), previousId ? getRun(repository, previousId) : null, listReviews(repository)
  ])
  if (version !== scopeVersion) return
  options($('repository'), [...new Set(library.map(item => item.repository))].sort(), null, repository)
  options($('run'), ordered.map(item => item.runId), null, active.runId)
  options($('baseline'), older.map(item => item.runId), 'None', previousId || '')
  $('baseline').disabled = !older.length
  run = current
  baseline = previous && snapshotAt(previous)
  reviews.load(repository, records)
  selection = null
  clearFilters()
  history.replaceState(null, '', assessmentURL(run))
  $('empty-library').hidden = true
  $('assessment-content').hidden = false
  await setStep(run.events.length)
}

async function loadLibrary(preferred) {
  library = await listRuns()
  if (!library.length) {
    $('empty-library').hidden = false
    return
  }
  const target = library.find(item => item.repository === preferred?.repository && item.runId === preferred?.runId) ?? library[0]
  await openRun(target.repository, target.runId)
}

async function importText(text) {
  await loadLibrary(await importAssessmentText(text))
}

async function importAction(work) {
  $('import-error').hidden = true
  const buttons = ['import-json', 'paste-open', 'load-example'].map($)
  buttons.forEach(button => { button.disabled = true })
  try { await work() } catch (error) { errorNotice(error) }
  finally { buttons.forEach(button => { button.disabled = false }) }
}

$('import-json').onclick = () => $('json-files').click()
$('json-files').onchange = event => {
  const files = [...event.target.files]
  event.target.value = ''
  if (files.length) importAction(async () => loadLibrary(await importFiles(files)))
}
$('load-example').onclick = () => importAction(async () => {
  const response = await fetch('./assessment-example.json')
  if (!response.ok) throw Error('Could not load the example assessment.')
  await importText(await response.text())
})
$('paste-open').onclick = () => {
  $('paste-error').hidden = true
  $('paste-dialog').showModal()
  $('paste-text').focus()
}
$('paste-cancel').onclick = () => $('paste-dialog').close()
$('paste-form').onsubmit = async event => {
  event.preventDefault()
  const submit = event.submitter
  if (submit) submit.disabled = true
  try {
    await importText($('paste-text').value)
    $('paste-text').value = ''
    $('import-error').hidden = true
    $('paste-dialog').close()
  } catch (error) {
    $('paste-error').textContent = error.message
    $('paste-error').hidden = false
  } finally { if (submit) submit.disabled = false }
}

$('repository').onchange = () => openRun($('repository').value).catch(errorNotice)
$('run').onchange = () => openRun($('repository').value, $('run').value).catch(errorNotice)
$('baseline').onchange = async () => {
  const version = ++comparisonVersion
  try {
    const previous = $('baseline').value && await getRun(run.repository, $('baseline').value)
    if (version !== comparisonVersion) return
    baseline = previous && snapshotAt(previous)
    updateComparison()
  } catch (error) { errorNotice(error) }
}
$('coverage-kind').onchange = () => showCoverage(graph, baseline, $('coverage-kind').value)
for (const key of [...facets, 'unresolved', 'isolate']) $('filter-' + key).onchange = drawGraph
let searchTimer
$('filter-symbol').oninput = () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(drawGraph, 150)
}
$('clear-filters').onclick = () => { clearFilters(); drawGraph() }
function setInspectorTab(review) {
  $('analysis-details').hidden = review
  $('human-review').hidden = !review
  $('analysis-tab').setAttribute('aria-pressed', String(!review))
  $('review-tab').setAttribute('aria-pressed', String(review))
}
$('analysis-tab').onclick = () => setInspectorTab(false)
$('review-tab').onclick = () => setInspectorTab(true)
$('subject').onchange = () => {
  if (!$('subject').value) return choose(null)
  const [table, id] = JSON.parse($('subject').value)
  choose({ table, id })
}
$('trace-mode').onchange = () => inspector?.setMode($('trace-mode').value)
$('step').oninput = () => { stopPlayback(); setStep(Number($('step').value)) }
$('previous-step').onclick = () => { stopPlayback(); setStep(step - 1) }
$('next-step').onclick = () => { stopPlayback(); setStep(step + 1) }
$('play').onclick = play
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('paste-dialog').open) { stopPlayback(); choose(null) }
})

function filename(extension) {
  return (run.repository + '-' + run.runId).replace(/[^a-zA-Z0-9._-]+/g, '-') + '-step-' + step + extension
}
$('export-svg').onclick = () => downloadFile(filename('.svg'), svg, 'image/svg+xml')
$('export-mmd').onclick = () => downloadFile(filename('.mmd'), exportMermaid(view, compiled, reviews.latest), 'text/plain')
bindTheme(() => { if (run) drawGraph() })
const query = new URLSearchParams(location.search)
loadLibrary({ repository: query.get('repository'), runId: query.get('run') }).catch(errorNotice)
