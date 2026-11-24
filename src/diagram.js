import mermaid from './vendor/mermaid.esm.min.mjs'

const $ = id => document.getElementById(id)
export const limit = 2_000_000
function configureTheme() {
  const dark = document.documentElement.dataset.theme === 'dark'
  const colors = dark ? {
    darkMode: true, background: '#101515', primaryColor: '#24312e',
    primaryBorderColor: '#719184', primaryTextColor: '#e2ebe6',
    secondaryColor: '#2c3939', tertiaryColor: '#303736',
    textColor: '#e2ebe6', lineColor: '#98aca3', edgeLabelBackground: '#202825',
    clusterBkg: '#353b3a', clusterBorder: '#78837f'
  } : {
    primaryColor: '#f0ecff', primaryBorderColor: '#9884cf', primaryTextColor: '#302449',
    lineColor: '#8b8c9f', edgeLabelBackground: '#fdfdfe', background: '#ffffff'
  }
  const shapeStyles = dark
    ? '.entry .label-container{fill:#263931;stroke:#79a48c}.service .label-container{fill:#24343a;stroke:#749ba6}.storage .label-container{fill:#363329;stroke:#a49b75}.cluster rect{fill:rgba(220,227,224,.12)!important;stroke:#74827b}'
    : '.entry .label-container{fill:#ece6ff;stroke:#9981d2}.service .label-container{fill:#e7f3f2;stroke:#77aba7}.storage .label-container{fill:#fff2da;stroke:#c5a46e}'
  mermaid.initialize({
    startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
    maxTextSize: limit, maxEdges: 10000, htmlLabels: false, theme: 'base',
    themeVariables: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: '16px', ...colors },
    themeCSS: shapeStyles + '.node rect.label-container{rx:7px;ry:7px}.edgeLabel{font-size:13px}',
    flowchart: { curve: 'basis', rankSpacing: 42, nodeSpacing: 56, padding: 18 }
  })
  $('theme-switch').setAttribute('aria-pressed', String(dark))
  $('theme-switch').title = dark ? 'Switch to light theme' : 'Switch to dark theme'
}

export function bindTheme(onChange) {
  configureTheme()
  $('theme-switch').onclick = () => {
    const root = document.documentElement
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem('kurapika-theme', root.dataset.theme) } catch { /* Session-only preference. */ }
    configureTheme()
    onChange()
  }
}

export async function renderDiagram(source) {
  if (source.length > limit) throw Error('Diagram exceeds the 2 million character limit.')
  let { svg } = await mermaid.render('mermaid-preview', source)
  if (source.startsWith('%% Kurapika assessment\n') && svg.includes('&amp;#')) {
    // The SVG renderer sometimes leaves numeric Mermaid entities as text in edge labels.
    // Update only text nodes, preserving the renderer's sanitized markup and attributes.
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    for (const span of doc.querySelectorAll('.edgeLabel .text-inner-tspan')) {
      span.textContent = span.textContent.replace(/&#(\d+);/g, (entity, digits) => {
        const code = Number(digits)
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
      })
    }
    svg = new XMLSerializer().serializeToString(doc.documentElement)
  }
  const parsed = await mermaid.mermaidAPI.getDiagramFromText(source)
  return { svg, layout: parsed.db.getData?.() }
}

export function downloadFile(filename, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
