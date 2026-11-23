// Mermaid's layout model preserves parallel edges, explicit edge IDs and subgraphs.
export function attachInspector(svg, layout, hint, onFocus) {
  const nodes = new Map()
  const elements = new Map(Array.from(svg.querySelectorAll('g.node, g.cluster'), el => [el.id, el]))
  for (const { id, domId } of layout?.nodes ?? []) {
    const el = elements.get(domId) || elements.get(svg.id + '-' + domId) || elements.get(id)
    if (el) nodes.set(id, el)
  }
  const edges = new Map((layout?.edges ?? []).map(edge => [edge.id, edge]))
  const paths = [...svg.querySelectorAll('path[data-edge]')]
  const labels = [...svg.querySelectorAll('.edgeLabel .label[data-id]')]
  const initial = nodes.size ? 'Select a node to inspect its connections' : 'Use the controls to zoom and fit the diagram'
  hint.textContent = initial
  let selected
  function select(id) {
    if (!id && !selected) return
    selected = id === selected ? null : id
    const adjacent = new Set([selected])
    const active = new Set()
    for (const edge of edges.values()) {
      if (selected === edge.start || selected === edge.end) {
        adjacent.add(edge.start)
        adjacent.add(edge.end)
        active.add(edge.id)
      }
    }
    for (const [key, node] of nodes) {
      // A nested group can contain the selected node and its incident paths.
      node.classList.toggle('dimmed', !!selected && !adjacent.has(key) && !node.classList.contains('cluster'))
      node.classList.toggle('selected', key === selected)
      node.classList.toggle('neighbor', key !== selected && adjacent.has(key))
      node.setAttribute('aria-pressed', String(key === selected))
    }
    for (const path of paths) {
      const key = path.dataset.id
      path.classList.toggle('dimmed', !!selected && !active.has(key))
      path.classList.toggle('flowing', active.has(key))
      path.classList.toggle('incoming', active.has(key) && edges.get(key)?.end === selected)
    }
    for (const label of labels) label.parentElement.classList.toggle('dimmed', !!selected && !active.has(label.dataset.id))
    hint.textContent = selected ? (nodes.get(selected).textContent.trim() || selected) + ' · ' + active.size + ' immediate connection' + (active.size === 1 ? '' : 's') : initial
    onFocus(nodes.get(selected), [...adjacent].map(key => nodes.get(key)).filter(Boolean))
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
    clear: () => select(null),
    get selected() { return selected },
    restore(id) { if (nodes.has(id)) select(id) }
  }
}
