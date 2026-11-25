import { createTracer } from './trace.js'

// The function entry is a source node. A node marked with the `entry` class wins when several sources exist.
export function chooseEntryId(nodes, edges) {
  const incoming = new Set()
  for (const edge of edges) if (edge?.end != null) incoming.add(edge.end)
  const ordered = nodes.filter(node => node && !node.cluster)
  if (!ordered.length) return null
  const roots = ordered.filter(node => !incoming.has(node.id))
  const pool = roots.length ? roots : ordered
  return (pool.find(node => node.entry) ?? pool[0]).id
}

// Mermaid's layout model preserves parallel edges, explicit edge IDs and subgraphs.
export function attachInspector(svg, layout, hint, onFocus) {
  const nodes = new Map()
  const elements = new Map(Array.from(svg.querySelectorAll('g.node, g.cluster'), el => [el.id, el]))
  for (const { id, domId } of layout?.nodes ?? []) {
    const el = elements.get(domId) || elements.get(svg.id + '-' + domId) || elements.get(id)
    if (el) nodes.set(id, el)
  }
  const edges = layout?.edges ?? []
  const trace = createTracer(edges)
  const paths = [...svg.querySelectorAll('path[data-edge]')]
  const labels = [...svg.querySelectorAll('.edgeLabel .label[data-id]')]
  const initial = nodes.size ? 'Select a node to inspect its connections' : 'Use the controls to zoom and fit the diagram'
  hint.textContent = initial
  let selected
  let mode = 'immediate'
  function paint(id = selected) {
    selected = id ?? null
    const { reached, active, reverse } = trace(selected, mode)
    for (const [key, node] of nodes) {
      // A nested group can contain the selected node and its incident paths.
      node.classList.toggle('dimmed', !!selected && !reached.has(key) && !node.classList.contains('cluster'))
      node.classList.toggle('selected', key === selected)
      node.classList.toggle('neighbor', key !== selected && reached.has(key))
      node.setAttribute('aria-pressed', String(key === selected))
    }
    for (const path of paths) {
      const key = path.dataset.id
      path.classList.toggle('dimmed', !!selected && !active.has(key))
      path.classList.toggle('flowing', active.has(key))
      path.classList.toggle('incoming', reverse.has(key))
    }
    for (const label of labels) label.parentElement.classList.toggle('dimmed', !!selected && !active.has(label.dataset.id))
    hint.textContent = selected ? (nodes.get(selected).textContent.trim() || selected) + ' · ' + active.size + (mode === 'immediate' ? ' immediate connection' : ' traced connection') + (active.size === 1 ? '' : 's') : initial
    onFocus(nodes.get(selected), [...reached].map(key => nodes.get(key)).filter(Boolean), selected)
  }
  function select(id) {
    if (id == null && selected == null) return
    paint(id === selected ? null : id)
  }
  function entryElement() {
    const described = [...nodes].map(([id, el]) => ({
      id,
      entry: el.classList.contains('entry') || !!el.querySelector('.entry'),
      cluster: el.classList.contains('cluster')
    }))
    const id = chooseEntryId(described, edges)
    if (!id) {
      if (selected != null) paint(null)
      return null
    }
    paint(id)
    return nodes.get(id) ?? null
  }
  for (const [id, node] of nodes) {
    node.classList.add('inspectable')
    node.setAttribute('tabindex', '0')
    node.setAttribute('role', 'button')
    node.setAttribute('aria-label', 'Inspect ' + (node.textContent.trim() || id))
    node.setAttribute('aria-pressed', 'false')
    node.addEventListener('click', event => {
      event.stopPropagation()
      select(id)
    })
    node.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        select(id)
      }
    })
  }
  return {
    clear() { if (selected != null) select(null) },
    setMode(value) {
      mode = value
      if (selected != null) paint()
    },
    focusEntry: entryElement,
    has: id => nodes.has(id),
    get selected() { return selected },
    restore(id) { if (nodes.has(id)) paint(id) }
  }
}
