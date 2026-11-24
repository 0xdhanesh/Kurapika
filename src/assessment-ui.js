import { isPagedText } from './assessment-pages.js'
import { readTextPage } from './assessment-store.js'
import { compareGraphs, coverage } from './assessment-graph.js'

export const $ = id => document.getElementById(id)

export function countLabel(count, noun) {
  return count + ' ' + noun + (count === 1 ? '' : 's')
}

export function element(tag, text, className) {
  const el = document.createElement(tag)
  if (text !== undefined) el.textContent = text
  if (className) el.className = className
  return el
}

// Keep only the selected excerpt and its successor in the viewer.
export function narrative(value) {
  if (!isPagedText(value)) return element('span', value)
  const box = element('details')
  box.append(element('summary', 'Read text · ' + value.length.toLocaleString() + ' characters'))
  const content = element('pre')
  const previous = element('button', 'Previous excerpt')
  const next = element('button', 'Next excerpt')
  const status = element('span')
  box.append(content, previous, status, next)
  let page = 0, version = 0
  const cache = new Map()
  function load(i) {
    if (!cache.has(i)) cache.set(i, readTextPage(value.textPages[i]))
    return cache.get(i)
  }
  async function show(i) {
    const current = ++version
    page = i
    previous.disabled = i === 0
    next.disabled = i + 1 === value.textPages.length
    status.textContent = ' ' + (i + 1) + ' / ' + value.textPages.length + ' '
    content.textContent = 'Loading…'
    try {
      const text = await load(i)
      if (current !== version) return
      content.textContent = text
      for (const k of cache.keys()) if (k !== i && k !== i + 1) cache.delete(k)
      if (!next.disabled) load(i + 1).catch(() => cache.delete(i + 1))
    } catch (error) { if (current === version) content.textContent = error.message }
  }
  box.ontoggle = () => {
    if (box.open) show(page)
    else { ++version; content.textContent = ''; cache.clear() }
  }
  previous.onclick = () => show(page - 1)
  next.onclick = () => show(page + 1)
  return box
}

export function pagedList(container, records, append, size = 50) {
  let offset = 0
  const more = element('button', 'Show more')
  function show() {
    more.remove()
    for (const row of records.slice(offset, offset + size)) append(row)
    offset += size
    if (offset < records.length) container.append(more)
  }
  more.onclick = show
  show()
}

export function options(select, values, first, selected = select.value) {
  select.replaceChildren()
  if (first) select.add(new Option(first, ''))
  for (const value of values) select.add(new Option(value, value))
  if ([...select.options].some(o => o.value === selected)) select.value = selected
}

const metrics = [
  ['indexed', 'Indexed', 'All indexed subjects at this timeline position.'],
  ['analyzed', 'Analyzed', 'Subjects with an analysis summary or an analyzed or validated status.'],
  ['validated', 'Independently validated', 'Confirmed by a named validator different from the named analyst.'],
  ['unresolved', 'Unresolved', 'Open subjects or subjects with an unresolved relationship.'],
  ['blocked', 'Blocked', 'Subjects marked blocked in the imported run.']
]

export function showCoverage(graph, baseline, table) {
  const counts = coverage(graph, table)
  const before = baseline && coverage(baseline, table)
  const cells = metrics.map(([key, title, explanation]) => {
    const cell = element('div')
    const term = element('dt', title)
    term.title = explanation
    const number = element('dd', counts[key])
    if (before) {
      const delta = counts[key] - before[key]
      const difference = element('small', 'Δ ' + (delta > 0 ? '+' : '') + delta)
      difference.title = 'Change from comparison run'
      difference.setAttribute('aria-label', difference.textContent + ' from comparison run')
      number.append(difference)
    }
    cell.append(term, number)
    return cell
  })
  $('metrics').replaceChildren(...cells)
}

function diffValue(value) {
  if (isPagedText(value)) return narrative(value)
  if (typeof value === 'string') return element('pre', value || '(empty)')
  const excerpts = []
  const formatted = JSON.stringify(value, (key, item) => {
    if (!isPagedText(item)) return item
    excerpts.push(item)
    return 'Excerpt ' + excerpts.length + ' · ' + item.length + ' characters'
  }, 2)
  const fragment = document.createDocumentFragment()
  fragment.append(element('pre', formatted))
  for (const excerpt of excerpts) fragment.append(narrative(excerpt))
  return fragment
}

export function showComparison(graph, baseline, baselineId, onSelect) {
  const container = $('diff-list')
  container.replaceChildren()
  if (!baseline) {
    $('comparison-caption').textContent = 'Choose an earlier assessment from this repository to compare.'
    return
  }
  const rows = compareGraphs(baseline, graph)
  $('comparison-caption').textContent = baselineId + ' (final) → current timeline position · ' +
    (rows.length ? countLabel(rows.length, 'changed record') : 'No changes')
  if (!rows.length) return
  const table = element('table')
  const head = table.createTHead().insertRow()
  for (const title of ['Record', 'ID', 'Change', 'Details']) head.append(element('th', title))
  const body = table.createTBody()
  const recordTypes = { nodes: 'Node', chains: 'Chain', relationships: 'Relationship', evidence: 'Evidence' }
  pagedList(container, rows, row => {
    const tr = body.insertRow()
    tr.insertCell().textContent = recordTypes[row.table]
    const id = tr.insertCell()
    if (row.current && ['nodes', 'chains'].includes(row.table)) {
      const button = element('button', row.id, 'jump')
      button.onclick = () => onSelect({ table: row.table, id: row.id })
      id.append(button)
    } else id.textContent = row.id
    tr.insertCell().textContent = row.change
    const cell = tr.insertCell()
    const details = element('details')
    details.append(element('summary', row.fields.join(', ') || 'Record'))
    // Large comparisons only materialize expanded records.
    details.ontoggle = () => {
      if (!details.open || details.children.length > 1) return
      for (const field of row.fields.length ? row.fields : Object.keys(row.current || row.old)) {
        const part = element('div')
        part.append(element('strong', field))
        if (row.old) part.append('Before · ', diffValue(row.old[field]))
        if (row.current) part.append('After · ', diffValue(row.current[field]))
        details.append(part)
      }
    }
    cell.append(details)
  })
  container.prepend(table)
}
