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

function valueText(value) {
  if (typeof value === 'string') return value || '(empty)'
  return JSON.stringify(value, null, 2)
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
  for (const row of rows) {
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
        if (row.old) part.append(element('pre', 'Before · ' + valueText(row.old[field])))
        if (row.current) part.append(element('pre', 'After · ' + valueText(row.current[field])))
        details.append(part)
      }
    }
    cell.append(details)
  }
  container.append(table)
}
