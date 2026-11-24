import './icons.js'
import { bindTheme, downloadFile, renderDiagram } from './diagram.js'
import { bindViewport } from './viewport.js'
import { attachInspector } from './inspect.js'
import { graphAreas, isPagedText } from './assessment-pages.js'
import { exportMermaid, filterGraph, toMermaid } from './assessment-graph.js'
import { stageCursor, getRunIndex, listReviews, listRuns } from './assessment-store.js'
import { assessmentURL, importAssessmentText, importFiles, workerRequest } from './assessment-import.js'
import { inspectSubject } from './assessment-inspector.js'
import { bindReviews } from './assessment-review.js'
import { $, countLabel, narrative, options, showComparison, showCoverage } from './assessment-ui.js'

let library = []
let run, graph, baseline
let selection = null
let step = 0
let cursor, stageQueue = Promise.resolve(), stageVersion = 0
let area = 0, areas, filtered
function resetArea() { area = 0; areas = null }

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
    const choices = new Set(values[key].filter(Boolean))
    if (input.value) choices.add(input.value)
    const sorted = [...choices].sort()
    if (sorted.length <= 150 && input.tagName === 'SELECT') {
      options(input, sorted, 'All')
      continue
    }
    // An inventory can have a distinct file per node. Keep the native
    // suggestion menu bounded while accepting any exact value in the index.
    let search = input
    if (input.tagName === 'SELECT') {
      search = document.createElement('input')
      search.type = 'search'
      search.id = input.id
      search.placeholder = 'All'
      search.value = input.value
      search.onchange = input.onchange
      const list = document.createElement('datalist')
      list.id = input.id + '-choices'
      search.setAttribute('list', list.id)
      input.replaceWith(search, list)
    }
    const suggest = () => {
      const query = search.value.toLowerCase()
      const matches = []
      for (const value of sorted) {
        if (value.toLowerCase().includes(query)) matches.push(new Option(value, value))
        if (matches.length === 100) break
      }
      search.list.replaceChildren(...matches)
    }
    search.oninput = suggest
    suggest()
  }
}

function populateSubjects() {
  const select = $('subject')
  select.replaceChildren(new Option('Choose a node or chain', ''))
  const large = graph.nodes.size + graph.chains.size > 250
  $('subject-find-label').hidden = !large
  const query = large ? $('subject-find').value.trim().toLowerCase() : ''
  for (const table of ['nodes', 'chains']) {
    const group = document.createElement('optgroup')
    group.label = table === 'nodes' ? 'Nodes' : 'Chains'
    let shown = 0
    for (const row of graph[table].values()) {
      if (large && (shown >= 100 || !(row.id + ' ' + row.symbol).toLowerCase().includes(query))) {
        if (selection?.table !== table || selection.id !== row.id) continue
      }
      shown++
      group.append(new Option(row.symbol + (row.symbol === row.id ? '' : ' · ' + row.id), JSON.stringify([table, row.id])))
    }
    if (group.children.length) select.append(group)
  }
  select.value = selection ? JSON.stringify([selection.table, selection.id]) : ''
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
    else if (selection && !alias) $('hint').textContent = 'The selected node is outside the displayed graph.'
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
  if (view?.limited || isolated) { resetArea(); populateSubjects(); drawGraph() }
  else syncFocus()
}

function drawGraph() {
  const version = ++renderVersion
  if (!areas) {
    filtered = filterGraph(graph, filters(), selection)
    const anchor = selection?.table === 'chains' ? graph.chains.get(selection.id)?.members[0] : selection?.id
    areas = graphAreas(filtered, anchor)
  }
  view = areas.get(area)
  $('page-prev').hidden = $('page-next').hidden = !view.limited
  $('page-prev').disabled = area === 0
  $('page-next').disabled = !view.hasNext
  compiled = toMermaid(view)
  inspector = null
  svg = ''
  $('drawing').replaceChildren()
  camera.focus(null, [])
  $('trace-mode').disabled = $('export-svg').disabled = true
  $('export-mmd').disabled = !view.nodes.length
  $('graph-count').textContent = countLabel(view.nodes.length, 'node') + ' · ' + countLabel(view.edges.length, 'relationship') + (view.limited ? ' shown of ' + filtered.nodes.length + ' nodes and ' + filtered.edges.length + ' relationships · Area ' + (area + 1) + ' · Trace and export this area' : '')
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
  const version = ++stageVersion
  const active = cursor
  stageQueue = stageQueue.catch(() => {}).then(async () => {
    if (version !== stageVersion) return
    const state = await active.seek(value, () => version !== stageVersion || active !== cursor)
    if (version !== stageVersion || active !== cursor) return
    graph = state.graph
    step = value
    resetArea()
    return displayStep(state.event)
  }).catch(errorNotice)
  return stageQueue
}

function displayStep(event) {
  if (selection && !graph[selection.table].has(selection.id)) {
    selection = null
    $('filter-isolate').checked = false
  }
  const count = cursor.count
  $('step').max = count
  $('step').value = step
  $('step').disabled = $('play').disabled = !count
  $('previous-step').disabled = step === 0
  $('next-step').disabled = step === count
  $('step-count').textContent = 'Step ' + step + ' of ' + count
  $('event-summary').textContent = event
    ? [event.at, event.agent, (isPagedText(event.summary) ? 'Graph updated' : event.summary) || 'Graph updated'].filter(Boolean).join(' · ')
    : (count ? 'Initial graph' : 'Imported snapshot · no replay events')
  if (isPagedText(event?.summary)) $('event-summary').append(narrative(event.summary))
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
  if (step === cursor.count) await setStep(0)
  while (version === playbackVersion && step < cursor.count) {
    await new Promise(resolve => setTimeout(resolve, 950))
    if (version !== playbackVersion) return
    await setStep(step + 1)
  }
  if (version === playbackVersion) stopPlayback()
}

async function openIndex(repository, runId, entry) {
  if (!entry?.paged) await workerRequest({ migrate: [repository, runId] })
  return getRunIndex(repository, runId)
}

async function openRun(repository, runId) {
  const version = ++scopeVersion
  ++comparisonVersion
  stopPlayback()
  const ordered = library.filter(item => item.repository === repository)
  const index = Math.max(0, ordered.findIndex(item => item.runId === runId))
  const active = ordered[index]
  const older = ordered.slice(index + 1)
  const previousId = !active.paged || !older[0]?.paged || active.large || older[0]?.large ? null : older[0]?.runId
  const [current, previous, records] = await Promise.all([
    openIndex(repository, active.runId, active), previousId ? openIndex(repository, previousId, older[0]) : null, listReviews(repository)
  ])
  if (version !== scopeVersion) return
  options($('repository'), [...new Set(library.map(item => item.repository))].sort(), null, repository)
  options($('run'), ordered.map(item => item.runId), null, active.runId)
  options($('baseline'), older.map(item => item.runId), 'None', previousId || '')
  $('baseline').disabled = !older.length
  const prior = previous && (await stageCursor(previous).seek(previous.eventCount ?? previous.events.length)).graph
  if (version !== scopeVersion) return
  run = current
  baseline = prior
  cursor = stageCursor(current)
  reviews.load(repository, records)
  selection = null
  clearFilters()
  $('subject-find').value = ''
  history.replaceState(null, '', assessmentURL(run))
  $('empty-library').hidden = true
  $('assessment-content').hidden = false
  await setStep(current.eventCount ? 0 : cursor.count)
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
  $('import-progress').hidden = false
  try { await work() } catch (error) { errorNotice(error) }
  finally { $('import-progress').hidden = true; buttons.forEach(button => { button.disabled = false }) }
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
    const id = $('baseline').value
    const previous = id && await openIndex(run.repository, id, library.find(r => r.repository === run.repository && r.runId === id))
    const state = previous && await stageCursor(previous).seek(previous.eventCount ?? previous.events.length)
    if (version !== comparisonVersion) return
    baseline = state && state.graph
    updateComparison()
  } catch (error) { errorNotice(error) }
}
$('coverage-kind').onchange = () => showCoverage(graph, baseline, $('coverage-kind').value)
for (const key of [...facets, 'unresolved', 'isolate']) $('filter-' + key).onchange = () => { resetArea(); drawGraph() }
let searchTimer
$('filter-symbol').oninput = () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { resetArea(); drawGraph() }, 150)
}
$('subject-find').oninput = populateSubjects
function moveArea(direction) {
  area += direction
  drawGraph()
}
$('page-prev').onclick = () => moveArea(-1)
$('page-next').onclick = () => moveArea(1)
$('clear-filters').onclick = () => { clearFilters(); resetArea(); drawGraph() }
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
