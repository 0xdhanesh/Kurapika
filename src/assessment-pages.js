// Long narrative fields share immutable text chunks. Graph identifiers stay ordinary strings.
export const textPageSize = 16_384
export const eventPageSize = 32
export const isPagedText = value => Array.isArray(value?.textPages)

export async function mapNarratives(run, convert) {
  const pending = []
  function copy(value, key, parent) {
    if (['summary', 'detail', 'reason'].includes(key) &&
        (isPagedText(value) || typeof value === 'string' && value.length > 512)) {
      parent[key] = null
      pending.push(convert(value).then(replacement => { parent[key] = replacement }))
      return
    }
    if (!value || typeof value !== 'object') { parent[key] = value; return }
    const cloned = Array.isArray(value) ? [] : {}
    parent[key] = cloned
    for (const [field, item] of Object.entries(value)) copy(item, field, cloned)
  }
  const holder = {}
  copy(run, 'run', holder)
  await Promise.all(pending)
  return holder.run
}

// Walk each edge once, keeping both endpoints together across page boundaries.
export function graphAreas(view, anchor, width = 32, edgeLimit = 64) {
  if (view.nodes.length <= width && view.edges.length <= edgeLimit) {
    return { get: () => ({ ...view, limited: false, hasNext: false }) }
  }
  const nodes = new Map(view.nodes.map(node => [node.id, node]))
  const incident = new Map()
  for (const edge of view.edges) {
    for (const id of new Set([edge.source, edge.target])) {
      if (id === null) continue
      if (!incident.has(id)) incident.set(id, [])
      incident.get(id).push(edge)
    }
  }
  function* walk() {
    const visited = new Set(), seenEdges = new Set()
    const seeds = nodes.has(anchor) ? [anchor, ...nodes.keys()] : nodes.keys()
    for (const seed of seeds) {
      if (visited.has(seed)) continue
      const queue = [seed]
      visited.add(seed)
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i], edges = incident.get(id) ?? []
        if (!edges.length) yield { ids: [id] }
        for (const edge of edges) {
          if (seenEdges.has(edge.id)) continue
          seenEdges.add(edge.id)
          const other = edge.source === id ? edge.target : edge.source
          if (other !== null && !visited.has(other)) { visited.add(other); queue.push(other) }
          yield { ids: other === null ? [id] : [id, other], edge }
        }
      }
    }
  }
  function* partition() {
    let ids = new Set(), edges = []
    for (const item of walk()) {
      if (ids.size + new Set(item.ids.filter(id => !ids.has(id))).size > width ||
          (item.edge && edges.length === edgeLimit)) {
        yield { nodes: [...ids].map(id => nodes.get(id)), edges }
        ids = new Set(); edges = []
      }
      for (const id of item.ids) ids.add(id)
      if (item.edge) edges.push(item.edge)
    }
    if (ids.size) yield { nodes: [...ids].map(id => nodes.get(id)), edges }
  }
  let iterator = partition(), generated = -1
  const cache = new Map()
  return { get(index) {
    if (index <= generated && !cache.has(index)) {
      iterator = partition(); generated = -1; cache.clear()
    }
    while (generated < index + 1) {
      const next = iterator.next()
      if (next.done) break
      cache.set(++generated, next.value)
    }
    for (const key of cache.keys()) if (Math.abs(key - index) > 1) cache.delete(key)
    return { ...cache.get(index), limited: true, hasNext: cache.has(index + 1) }
  } }
}
