export function bindViewport(clearSelection) {
  const $ = id => document.getElementById(id)
  const drawing = $('drawing')
  const viewport = $('viewport')
  let focusRegion = null
  let zoom = 1

  function resize() {
    const svg = drawing.firstElementChild
    if (!svg) return
    const box = svg.viewBox.baseVal
    const width = Math.max(1, viewport.clientWidth - 54)
    const height = Math.max(1, viewport.clientHeight - 87)
    const overviewScale = Math.min(width / box.width, height / box.height, 1.65)
    let scale = overviewScale
    if (focusRegion) {
      const { radiusX, radiusY, nodeWidth, nodeHeight } = focusRegion
      const neighborhoodScale = Math.min(width / (2 * radiusX), height / (2 * radiusY))
      // A distant neighbor must not shrink the selected label to a few pixels.
      const readableScale = Math.min(1.2, width / nodeWidth, height / nodeHeight)
      scale = Math.min(2, Math.max(readableScale, neighborhoodScale))
      // Extra scroll space lets even the first or last node sit at the center.
      drawing.style.padding = viewport.clientHeight / 2 + 'px ' + viewport.clientWidth / 2 + 'px'
    } else {
      drawing.style.padding = ''
    }
    scale *= zoom
    svg.style.width = Math.max(1, box.width * scale) + 'px'
    svg.style.height = Math.max(1, box.height * scale) + 'px'
    $('scale').value = Math.round(scale / overviewScale * 100) + '%'
    if (focusRegion) {
      const rect = svg.getBoundingClientRect()
      const frame = viewport.getBoundingClientRect()
      viewport.scrollLeft += rect.left + rect.width * focusRegion.x - frame.left - viewport.clientWidth / 2
      viewport.scrollTop += rect.top + rect.height * focusRegion.y - frame.top - viewport.clientHeight / 2
    }
  }
  function setZoom(value) {
    zoom = Math.max(.25, Math.min(32, value))
    resize()
  }
  function focus(node, neighbors) {
    focusRegion = null
    if (node) {
      // Screen bounds include every nested Mermaid group transform.
      const svg = drawing.firstElementChild
      const rect = svg.getBoundingClientRect()
      const units = svg.viewBox.baseVal.width / rect.width
      const target = node.getBoundingClientRect()
      const cx = target.left + target.width / 2
      const cy = target.top + target.height / 2
      let radiusX = 1
      let radiusY = 1
      for (const neighbor of neighbors) {
        const bounds = neighbor.getBoundingClientRect()
        radiusX = Math.max(radiusX, cx - bounds.left, bounds.right - cx)
        radiusY = Math.max(radiusY, cy - bounds.top, bounds.bottom - cy)
      }
      focusRegion = {
        x: (cx - rect.left) / rect.width,
        y: (cy - rect.top) / rect.height,
        nodeWidth: Math.max(1, target.width * units),
        nodeHeight: Math.max(1, target.height * units),
        radiusX: radiusX * units, radiusY: radiusY * units
      }
    }
    $('overview').hidden = !node
    setZoom(1)
  }

  viewport.onclick = clearSelection
  $('plus').onclick = () => setZoom(zoom * 1.25)
  $('minus').onclick = () => setZoom(zoom / 1.25)
  $('fit').onclick = () => {
    clearSelection()
    setZoom(1)
  }
  $('overview').onclick = clearSelection
  new ResizeObserver(resize).observe(viewport)
  return { focus, resize, setZoom, get zoom() { return zoom } }
}
