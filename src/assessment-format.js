// Imported runs contain observations only. Human reviews have a separate store.
export const graphTables = ['nodes', 'relationships', 'chains']

function object(value, field) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(field + ' must be an object.')
  return value
}

function list(value, field) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw Error(field + ' must be an array.')
  return value
}

function string(value, field, fallback) {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'string' || (!value.trim() && fallback === undefined)) throw Error('Invalid ' + field + '.')
  return value
}

function timestamp(value) {
  if (value == null || value === '') return ''
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw Error('Expected an ISO timestamp.')
  return new Date(value).toISOString()
}

function link(value) {
  if (!value) return ''
  let url
  try { url = new URL(string(value, 'URL')) } catch { throw Error('Expected an absolute evidence or source URL.') }
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('Evidence and source URLs must use http or https.')
  return url.href
}

function ids(value, field) {
  return list(value, field).map(id => string(id, field + ' ID'))
}

function location(input) {
  if (typeof input === 'string') input = { file: input }
  const { file, line, endLine, url } = object(input, 'source location')
  for (const number of [line, endLine]) {
    if (number != null && (!Number.isSafeInteger(number) || number < 1)) throw Error('Source lines must be positive integers.')
  }
  if (endLine != null && (line == null || endLine < line)) throw Error('Invalid source line range.')
  return { file: string(file, 'source file'), line: line ?? null, endLine: endLine ?? null, url: link(url) }
}

function evidenceRefs(value, catalog) {
  const refs = ids(value, 'evidence')
  for (const ref of refs) if (!catalog.has(ref)) throw Error('Unknown evidence ID "' + ref + '".')
  return refs
}

function validation(input, catalog) {
  const v = object(input, 'validation')
  return {
    agent: string(v.agent, 'validation agent').trim(), result: string(v.result, 'validation result'),
    summary: string(v.summary, 'validation summary', ''), at: timestamp(v.at),
    evidence: evidenceRefs(v.evidence, catalog)
  }
}

function subject(input, table, catalog) {
  const id = string(input.id, table + ' ID')
  const item = {
    id, symbol: string(input.symbol, 'symbol', id),
    kind: table === 'chains' ? 'chain' : string(input.kind, 'node kind', 'function'),
    language: string(input.language, 'language', ''),
    status: string(input.status, 'status', 'indexed'), agent: string(input.agent, 'agent', '').trim(),
    summary: string(input.summary, 'summary', ''),
    locations: list(input.locations, 'locations').map(location),
    evidence: evidenceRefs(input.evidence, catalog),
    validations: list(input.validations, 'validations').map(record => validation(record, catalog))
  }
  if (table === 'chains') {
    item.members = ids(input.members, 'chain members')
    item.relationships = ids(input.relationships, 'chain relationships')
  }
  return item
}

function relationship(input, catalog) {
  const status = string(input.status, 'relationship status', 'resolved')
  return {
    id: string(input.id, 'relationship ID'), source: string(input.source, 'relationship source'),
    target: input.target === null && status === 'unresolved' ? null : string(input.target, 'relationship target'),
    type: string(input.type, 'relationship type', 'calls'), status,
    reason: string(input.reason, 'relationship reason', ''), agent: string(input.agent, 'agent', '').trim(),
    evidence: evidenceRefs(input.evidence, catalog)
  }
}

function emptyGraph() {
  return { nodes: new Map(), relationships: new Map(), chains: new Map() }
}

function checkEndpoints(graph, delta) {
  const removedNodes = delta.remove.nodes.length > 0
  const edges = removedNodes ? graph.relationships.values() : delta.relationships.map(row => graph.relationships.get(row.id))
  for (const edge of edges) {
    if (!graph.nodes.has(edge.source) || (edge.target !== null && !graph.nodes.has(edge.target))) {
      throw Error('Relationship "' + edge.id + '" references an unknown node.')
    }
  }
  const chains = removedNodes || delta.remove.relationships.length ? graph.chains.values() : delta.chains.map(row => graph.chains.get(row.id))
  for (const chain of chains) {
    for (const id of chain.members) if (!graph.nodes.has(id)) throw Error('Unknown node "' + id + '" in chain "' + chain.id + '".')
    for (const id of chain.relationships) if (!graph.relationships.has(id)) throw Error('Unknown relationship "' + id + '" in chain "' + chain.id + '".')
  }
}

// Normalize partial event updates while retaining only the fields supplied at that step.
function changes(input, graph, catalog, initial = false) {
  const delta = { remove: {} }
  if (input.remove !== undefined) object(input.remove, 'remove')
  for (const table of graphTables) {
    const rows = graph[table]
    const removed = ids(input.remove?.[table], 'removed ' + table)
    const touched = new Set(removed)
    for (const id of removed) if (!rows.delete(id)) throw Error('Cannot remove missing ' + table + ' ID "' + id + '".')
    delta.remove[table] = removed
    const incoming = table === 'relationships' && input.relationships === undefined ? input.edges : input[table]
    delta[table] = list(incoming, table).map((raw, i) => {
      object(raw, table + ' record')
      const id = initial && table === 'relationships' && raw.id === undefined ? 'edge-' + (i + 1) : string(raw.id, table + ' ID')
      if (touched.has(id)) throw Error('Duplicate ' + table + ' ID "' + id + '".')
      touched.add(id)
      const previous = rows.get(id)
      const merged = { ...previous, ...raw, id }
      if (table !== 'relationships' && raw.file !== undefined && raw.locations === undefined) {
        merged.locations = [{ file: raw.file, line: raw.line, endLine: raw.endLine, url: raw.url }]
      }
      const row = table === 'relationships' ? relationship(merged, catalog) : subject(merged, table, catalog)
      rows.set(id, row)
      if (!previous) return row
      const patch = { id }
      for (const field of Object.keys(row)) {
        if (Object.hasOwn(raw, field) || (field === 'locations' && Object.hasOwn(raw, 'file'))) patch[field] = row[field]
      }
      return patch
    })
  }
  checkEndpoints(graph, delta)
  return delta
}

function normalizeRun(input, filename) {
  const data = object(input, 'run')
  if (!Array.isArray(data.nodes)) throw Error('A graph requires a nodes array.')
  const repository = string(data.repository, 'repository', 'Local graphs')
  const runId = string(data.runId, 'runId', filename)
  if (!repository.trim() || !runId.trim()) throw Error('Repository and runId must be nonempty.')
  const catalog = new Map()
  for (const raw of list(data.evidence, 'evidence catalog')) {
    object(raw, 'evidence record')
    const id = string(raw.id, 'evidence ID')
    if (catalog.has(id)) throw Error('Duplicate evidence ID "' + id + '".')
    catalog.set(id, { id, label: string(raw.label, 'evidence label', id), url: link(raw.url), detail: string(raw.detail, 'evidence detail', '') })
  }
  const graph = emptyGraph()
  const initial = changes(data, graph, catalog, true)
  let lastTime = ''
  const events = list(data.events, 'events').map((raw, i) => {
    try {
      object(raw, 'event')
      const at = timestamp(raw.at)
      if (at && at < lastTime) throw Error('Events must be in chronological order.')
      if (at) lastTime = at
      return { at, agent: string(raw.agent, 'event agent', '').trim(), summary: string(raw.summary, 'event summary', ''),
        ...changes(raw, graph, catalog) }
    } catch (error) {
      throw Error('Event ' + (i + 1) + ': ' + error.message)
    }
  })
  return { repository, runId, at: timestamp(data.at), evidence: [...catalog.values()], initial, events }
}

export function parseAssessment(text, filename = 'graph') {
  return normalizeAssessment(JSON.parse(text), filename)
}

export function normalizeAssessment(input, filename) {
  const data = object(input, 'assessment')
  const runs = data.runs === undefined ? [data] : list(data.runs, 'runs')
  if (!runs.length) throw Error('Include at least one run.')
  return runs.map(run => normalizeRun(run, filename))
}

export function snapshotAt(run, step = run.events.length) {
  const graph = emptyGraph()
  applyDelta(graph, run.initial)
  for (let i = 0; i < step; i++) applyDelta(graph, run.events[i])
  graph.evidence = new Map(run.evidence.map(item => [item.id, item]))
  return graph
}

export function applyDelta(graph, delta) {
  for (const table of graphTables) {
    for (const id of delta.remove[table]) graph[table].delete(id)
    for (const item of delta[table]) graph[table].set(item.id, { ...graph[table].get(item.id), ...item })
  }
}
