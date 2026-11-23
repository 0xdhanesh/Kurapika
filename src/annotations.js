// A reserved Mermaid comment keeps node metadata portable with the diagram.
const prefix = '%% @kurapika-node '

export function readAnnotations(source) {
  const records = new Map()
  const lines = source.split('\n').filter(line => {
    if (!line.startsWith(prefix)) return true
    try {
      const { id, references, notes } = JSON.parse(line.slice(prefix.length))
      if ([id, references, notes].every(value => typeof value === 'string')) {
        records.set(id, { references, notes })
        return false
      }
    } catch { /* Preserve unrecognized comments verbatim. */ }
    return true
  })
  return { diagram: lines.join('\n'), records }
}

export function withAnnotations(diagram, records) {
  const lines = Array.from(records, ([id, fields]) => prefix + JSON.stringify({ id, ...fields }))
  return lines.length ? diagram + '\n' + lines.join('\n') : diagram
}
