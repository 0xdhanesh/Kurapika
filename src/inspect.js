import { createTracer } from './trace.js'

// Mermaid's layout model preserves parallel edges, explicit edge IDs and subgraphs.
export function attachInspector(svg, layout, hint, onFocus, canInspect = () => true) {
  const nodes = new Map()
  const elements = new Map(Array.from(svg.querySelectorAll('g.node, g.cluster'), el => [el.id, el]))
  for (const { id, domId } of layout?.nodes ?? []) {
    const el = elements.get(domId) || elements.get(svg.id + '-' + domId) || elements.get(id)
    if (el) nodes.set(id, el)
  }
  const trace = createTracer(layout?.edges ?? [])
  const paths = [...svg.querySelectorAll('path[data-edge]')]
  const labels = [...svg.querySelectorAll('.edgeLabel .label[data-id]')]
  const initial = nodes.size ? 'Select a node to inspect its connections' : 'Use the controls to zoom and fit the diagram'
  hint.textContent = initial
  let selected
  let mode = 'immediate'
  function paint() {
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
    selected = id === selected ? null : id
    paint()
  }
  for (const [id, node] of nodes) {
    if (!canInspect(id)) continue
    node.dataset.inspectId = id
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
    get selected() { return selected },
    restore(id) { if (nodes.has(id)) select(id) }
  }
}
