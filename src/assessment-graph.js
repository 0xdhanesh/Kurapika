import { withAnnotations } from './annotations.js'
import { graphTables } from './assessment-format.js'

export function isIndependent(subject, record) {
  return Boolean(subject.agent && record.agent !== subject.agent && record.result === 'confirmed')
}

export function coverage(graph, table) {
  const subjects = table === 'chains' ? [...graph.chains.values()] : [...graph.nodes.values()].filter(n => n.kind === 'function')
  const unresolvedNodes = new Set()
  const unresolvedEdges = new Set()
  for (const edge of graph.relationships.values()) {
    if (edge.status !== 'unresolved') continue
    unresolvedNodes.add(edge.source)
    unresolvedNodes.add(edge.target)
    unresolvedEdges.add(edge.id)
  }
  const counts = { indexed: subjects.length, analyzed: 0, validated: 0, unresolved: 0, blocked: 0 }
  for (const item of subjects) {
    if ((typeof item.summary === 'string' ? item.summary.trim() : item.summary.hasText) || ['analyzed', 'validated'].includes(item.status)) counts.analyzed++
    if (item.validations.some(v => isIndependent(item, v))) counts.validated++
    const unresolved = table === 'chains' ? item.relationships.some(id => unresolvedEdges.has(id)) : unresolvedNodes.has(item.id)
    if (item.status === 'unresolved' || unresolved) counts.unresolved++
    if (item.status === 'blocked') counts.blocked++
  }
  return counts
}

function component(root, edges) {
  const neighbors = new Map()
  for (const { source, target } of edges) {
    if (target === null) continue
    if (!neighbors.has(source)) neighbors.set(source, [])
    if (!neighbors.has(target)) neighbors.set(target, [])
    neighbors.get(source).push(target)
    neighbors.get(target).push(source)
  }
  const reached = new Set([root])
  const stack = [root]
  while (stack.length) {
    for (const next of neighbors.get(stack.pop()) ?? []) {
      if (reached.has(next)) continue
      reached.add(next)
      stack.push(next)
    }
  }
  return reached
}

export function filterGraph(graph, filters = {}, selection = null) {
  const query = (filters.symbol ?? '').trim().toLowerCase()
  let nodes = [...graph.nodes.values()].filter(n =>
    (!query || n.symbol.toLowerCase().includes(query) || n.id.toLowerCase().includes(query)) &&
    (!filters.file || n.locations.some(loc => loc.file === filters.file)) &&
    (!filters.language || n.language === filters.language) &&
    (!filters.status || n.status === filters.status))
  const allowed = new Set(nodes.map(n => n.id))
  const agentMatches = new Set()
  const chainMembers = new Set()
  const chainEdges = new Set()
  if (filters.agent) {
    const contributed = item => item.agent === filters.agent || item.validations.some(v => v.agent === filters.agent)
    for (const node of nodes) if (contributed(node)) agentMatches.add(node.id)
    for (const chain of graph.chains.values()) {
      if (!contributed(chain)) continue
      for (const id of chain.members) chainMembers.add(id)
      for (const id of chain.relationships) chainEdges.add(id)
    }
  }
  let edges = [...graph.relationships.values()].filter(e =>
    allowed.has(e.source) && (e.target === null || allowed.has(e.target)) &&
    (!filters.type || e.type === filters.type) && (!filters.unresolved || e.status === 'unresolved') &&
    (!filters.agent || e.agent === filters.agent || chainEdges.has(e.id) || agentMatches.has(e.source) || agentMatches.has(e.target)))
  if (filters.type || filters.unresolved || filters.agent) {
    const endpoints = new Set(edges.flatMap(e => [e.source, e.target]))
    const includeContributors = filters.agent && !filters.type && !filters.unresolved
    nodes = nodes.filter(n => endpoints.has(n.id) || (includeContributors && (agentMatches.has(n.id) || chainMembers.has(n.id))))
  }
  if (filters.isolate && selection) {
    let keep
    if (selection.table === 'chains') {
      const chain = graph.chains.get(selection.id)
      keep = new Set(chain?.members)
      if (chain?.relationships.length) {
        const links = new Set(chain.relationships)
        edges = edges.filter(e => links.has(e.id))
        for (const edge of edges) { keep.add(edge.source); keep.add(edge.target) }
      }
    } else keep = component(selection.id, edges)
    nodes = nodes.filter(n => keep.has(n.id))
    edges = edges.filter(e => keep.has(e.source) && (e.target === null || keep.has(e.target)))
  }
  return { nodes, edges }
}

export function compareGraphs(before, after) {
  const rows = []
  for (const table of [...graphTables, 'evidence']) {
    for (const id of new Set([...before[table].keys(), ...after[table].keys()])) {
      const old = before[table].get(id)
      const current = after[table].get(id)
      if (!old || !current) {
        rows.push({ table, id, change: old ? 'Removed' : 'Added', fields: [], old, current })
      } else {
        const fields = Object.keys(current).filter(key => JSON.stringify(current[key]) !== JSON.stringify(old[key]))
        if (fields.length) rows.push({ table, id, change: 'Changed', fields, old, current })
      }
    }
  }
  return rows
}

export function sourceLabel(loc) {
  if (loc.line === null) return loc.file
  return loc.file + ':' + loc.line + (loc.endLine && loc.endLine !== loc.line ? '–' + loc.endLine : '')
}

// Mermaid node attributes use YAML quoted scalars. Escape grammar characters before parsing
// and preserve literal angle brackets through Mermaid's SVG text sanitizer.
function nodeLabel(value) {
  return value.replace(/\s+/gu, ' ').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replace(/[^\p{L}\p{N} ._:/-]/gu, ch => {
      const point = ch.codePointAt(0)
      return point <= 0xffff ? '\\u' + point.toString(16).padStart(4, '0') : '\\U' + point.toString(16).padStart(8, '0')
    })
}

function edgeLabel(value) {
  return value.replace(/\s+/gu, ' ').replace(/[&<>"#%`|\\$\x00-\x1f]/gu, ch => {
    if (ch === '<') return '#lt;'
    if (ch === '>') return '#gt;'
    if (ch === '&') return '#amp;'
    return '#' + ch.codePointAt(0) + ';'
  })
}

export function toMermaid(view) {
  const lines = ['%% Kurapika assessment', 'flowchart LR']
  const aliases = new Map()
  const originalIds = new Map()
  const strokes = new Map([['analyzed', '#738bb6'], ['validated', '#4e9874'], ['unresolved', '#b18a35'], ['blocked', '#be7771']])
  const usedStyles = new Set()
  view.nodes.forEach((node, index) => {
    const alias = 'n' + index
    aliases.set(node.id, alias)
    originalIds.set(alias, node.id)
    lines.push('  ' + alias + '@{ shape: rect, label: "' + nodeLabel(node.symbol || node.id) + '" }')
    if (strokes.has(node.status)) {
      usedStyles.add(node.status)
      lines.push('  class ' + alias + ' s_' + node.status)
    }
  })
  view.edges.forEach((edge, index) => {
    let target = aliases.get(edge.target)
    if (edge.target === null) {
      target = 'unknown' + index
      lines.push('  ' + target + '(["Unknown target"])')
    }
    const arrow = edge.status === 'unresolved' ? '-.->' : '-->'
    lines.push('  ' + aliases.get(edge.source) + ' e' + index + '@' + arrow + '|"' + edgeLabel(edge.type) + '"| ' + target)
  })
  for (const status of usedStyles) lines.push('  classDef s_' + status + ' stroke:' + strokes.get(status) + ',stroke-width:2px')
  return { diagram: lines.join('\n'), aliases, originalIds }
}

export function exportMermaid(view, compiled, reviews) {
  const annotations = new Map()
  for (const node of view.nodes) {
    const review = reviews.get(JSON.stringify(['nodes', node.id]))
    const references = [...node.locations.map(sourceLabel), review?.references].filter(Boolean).join('\n')
    if (references || review?.notes) annotations.set(compiled.aliases.get(node.id), { references, notes: review?.notes || '' })
  }
  return withAnnotations(compiled.diagram, annotations)
}
