export function createTracer(edges) {
  const incident = new Map()
  function addConnection(edge, reverse) {
    const from = reverse ? edge.end : edge.start
    const ahead = reverse ? edge.arrowTypeStart : edge.arrowTypeEnd
    const behind = reverse ? edge.arrowTypeEnd : edge.arrowTypeStart
    const visible = edge.thickness !== 'invisible'
    if (!incident.has(from)) incident.set(from, [])
    incident.get(from).push({
      to: reverse ? edge.start : edge.end,
      id: edge.id,
      reverse,
      forward: visible && !!ahead && ahead !== 'none',
      backward: visible && !!behind && behind !== 'none'
    })
  }
  for (const edge of edges) {
    addConnection(edge, false)
    addConnection(edge, true)
  }
  return function trace(selected, mode) {
    const reached = new Set()
    const active = new Set()
    const reverse = new Set()
    const pending = []
    if (selected != null) {
      reached.add(selected)
      pending.push(selected)
    }
    while (pending.length) {
      const current = pending.pop()
      for (const edge of incident.get(current) ?? []) {
        if (mode !== 'immediate' && !edge[mode]) continue
        if (!active.has(edge.id) && edge.reverse) reverse.add(edge.id)
        active.add(edge.id)
        if (!reached.has(edge.to)) {
          reached.add(edge.to)
          if (mode !== 'immediate') pending.push(edge.to)
        }
      }
    }
    return { reached, active, reverse }
  }
}
