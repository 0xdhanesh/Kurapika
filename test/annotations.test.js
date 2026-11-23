import test from 'node:test'
import assert from 'node:assert/strict'
import { readAnnotations, withAnnotations } from '../src/annotations.js'

test('annotations survive copying and reopening source without changing Mermaid text', () => {
  const diagram = 'flowchart TD\n A-->B\n%% @kurapika-node malformed comment\n'
  const records = new Map([
    ['A', { references: 'src/a.js:4\nsrc/b.js:7', notes: '“input”\n<check> "quotes" \\ ✓' }],
    ['B', { references: '', notes: 'Output' }]
  ])
  const saved = withAnnotations(diagram, records)
  const restored = readAnnotations(saved)
  assert.deepEqual(restored, { diagram, records })
  assert.equal(withAnnotations(restored.diagram, restored.records), saved)
  restored.records.delete('A')
  assert.deepEqual([...readAnnotations(withAnnotations(diagram, restored.records)).records.keys()], ['B'])
  restored.records.clear()
  assert.equal(withAnnotations(diagram, restored.records), diagram)
})
