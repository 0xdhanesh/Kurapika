import { isIndependent, sourceLabel } from './assessment-graph.js'
import { element, narrative, pagedList } from './assessment-ui.js'

function externalLink(label, url) {
  const a = element('a', label)
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  return a
}

export function inspectSubject(graph, selection, catalog, onSelect) {
  const item = graph[selection.table].get(selection.id)
  const identity = document.getElementById('subject-identity')
  identity.replaceChildren(element('h3', item.symbol), element('p', [item.kind, item.id, 'Analysis status · ' + item.status].join(' · ')))
  const details = document.getElementById('analysis-details')
  details.replaceChildren()
  const cited = new Map()
  let evidenceSection
  function section(title) {
    const el = element('section')
    el.append(element('h3', title))
    details.append(el)
    return el
  }
  function refs(parent, ids) {
    for (const id of ids) {
      const evidence = catalog.get(id)
      if (!cited.has(id)) {
        const entry = element('details')
        entry.id = 'citation-' + cited.size
        entry.append(element('summary', evidence.label))
        if (evidence.detail) entry.append(narrative(evidence.detail))
        if (evidence.url) entry.append(externalLink('Open evidence', evidence.url))
        cited.set(id, entry)
        if (evidenceSection) { evidenceSection.hidden = false; evidenceSection.append(entry) }
      }
      const entry = cited.get(id)
      const a = element('a', evidence.label)
      a.href = '#' + entry.id
      a.onclick = event => {
        event.preventDefault()
        entry.open = true
        entry.querySelector('summary').focus()
      }
      parent.append(' ', a)
    }
  }
  function nodeButton(id) {
    if (id === null) return document.createTextNode('Unknown target')
    const btn = element('button', graph.nodes.get(id).symbol, 'jump')
    btn.onclick = () => onSelect({ table: 'nodes', id })
    return btn
  }
  function showEdges(title, edges, endpoint) {
    const group = section(title)
    if (!edges.length) { group.append(element('p', 'None recorded.', 'muted')); return }
    const list = element('ul')
    group.append(list)
    pagedList(group, edges, edge => {
      const row = element('li')
      if (endpoint) row.append(nodeButton(edge[endpoint]))
      else row.append(nodeButton(edge.source), ' → ', nodeButton(edge.target))
      row.append(' · ' + [edge.type, edge.status, edge.agent].filter(Boolean).join(' · '))
      if (edge.reason) row.append(narrative(edge.reason))
      else if (edge.status === 'unresolved') row.append(element('p', 'Reason not supplied.', 'muted'))
      refs(row, edge.evidence)
      list.append(row)
    })
  }

  const analysis = section('Agent analysis')
  const attribution = [item.agent, item.language].filter(Boolean).join(' · ')
  if (attribution) analysis.append(element('p', attribution, 'muted'))
  analysis.append(narrative(item.summary || 'No summary recorded.'))
  refs(analysis, item.evidence)
  const sources = section('Source locations')
  for (const loc of item.locations) {
    const line = element('p')
    line.append(loc.url ? externalLink(sourceLabel(loc), loc.url) : sourceLabel(loc))
    sources.append(line)
  }
  if (!item.locations.length) sources.append(element('p', 'No locations recorded.', 'muted'))

  let edges
  if (selection.table === 'chains') {
    const group = section('Chain members')
    const list = element('ol')
    group.append(list)
    pagedList(group, item.members, id => {
      const member = element('li')
      member.append(nodeButton(id))
      list.append(member)
    })
    edges = item.relationships.map(id => graph.relationships.get(id))
    showEdges('Chain relationships', edges)
  } else {
    edges = [...graph.relationships.values()].filter(e => e.source === item.id || e.target === item.id)
    const calls = edges.filter(e => ['call', 'calls'].includes(e.type.toLowerCase()))
    showEdges('Callers', calls.filter(e => e.target === item.id), 'source')
    showEdges('Callees', calls.filter(e => e.source === item.id), 'target')
    const other = edges.filter(e => !['call', 'calls'].includes(e.type.toLowerCase()))
    if (other.length) showEdges('Other relationships', other)
  }
  const validations = section('Validation records')
  if (!item.validations.length) validations.append(element('p', 'No validations recorded.', 'muted'))
  pagedList(validations, item.validations, record => {
    const line = element('p', [record.agent, record.result, record.at].filter(Boolean).join(' · '))
    if (isIndependent(item, record)) line.append(' · Independent confirmation')
    if (record.summary) line.append(' ', narrative(record.summary))
    refs(line, record.evidence)
    validations.append(line)
  })
  evidenceSection = section('Evidence')
  evidenceSection.hidden = !cited.size
  for (const entry of cited.values()) evidenceSection.append(entry)
}
