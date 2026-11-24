import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseAssessment, snapshotAt } from '../src/assessment-format.js'
import { compareGraphs, coverage, exportMermaid, filterGraph, toMermaid } from '../src/assessment-graph.js'
import { readAnnotations } from '../src/annotations.js'

const runs = parseAssessment(readFileSync(new URL('../src/assessment-example.json', import.meta.url), 'utf8'))
const previous = snapshotAt(runs[0])
const current = snapshotAt(runs[1])
const parse = data => parseAssessment(JSON.stringify(data))[0]
const nodeIds = view => view.nodes.map(n => n.id).sort()
const edgeIds = view => view.edges.map(e => e.id).sort()

test('replay applies partial observations and rewinds without changing the initial graph', () => {
  const initial = snapshotAt(runs[1], 0)
  const middle = snapshotAt(runs[1], 1)
  assert.equal(initial.nodes.get('lookup').symbol, 'lookupBook')
  assert.equal(initial.nodes.get('lookup').status, 'indexed')
  assert.equal(middle.nodes.get('lookup').status, 'analyzed')
  assert.equal(current.nodes.get('lookup').validations[0].agent, 'verifier')
  assert.equal(current.nodes.get('lookup').locations[0].endLine, 17)
  assert.equal(initial.relationships.size, 1)
  assert.equal(middle.relationships.size, 2)
  assert.deepEqual(snapshotAt(runs[1], 0), initial)
})

test('removals and relationship retargeting apply atomically at one timeline position', () => {
  const run = parse({
    nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'ab', source: 'a', target: 'b' }],
    chains: [{ id: 'route', members: ['a', 'b'], relationships: ['ab'] }],
    events: [{ remove: { nodes: ['b'] }, relationships: [{ id: 'ab', target: null, status: 'unresolved' }], chains: [{ id: 'route', members: ['a'] }] }]
  })
  assert.equal(snapshotAt(run, 0).relationships.get('ab').target, 'b')
  const latest = snapshotAt(run)
  assert.equal(latest.relationships.get('ab').target, null)
  assert.deepEqual(latest.chains.get('route').members, ['a'])
  assert.deepEqual([...latest.nodes.keys()], ['a'])
})

test('coverage separates observations, independent confirmations and open relationships', () => {
  assert.deepEqual(coverage(current, 'nodes'), { indexed: 3, analyzed: 2, validated: 1, unresolved: 1, blocked: 1 })
  assert.deepEqual(coverage(current, 'chains'), { indexed: 1, analyzed: 1, validated: 0, unresolved: 1, blocked: 0 })
  const graph = snapshotAt(parse({ nodes: [
    { id: 'self', status: 'validated', agent: 'reader', validations: [{ agent: 'reader', result: 'confirmed' }] },
    { id: 'only-review', review: { decision: 'reviewed' } },
    { id: 'unknown-analyst', validations: [{ agent: 'checker', result: 'confirmed' }] },
    { id: 'different-opinion', agent: 'reader', validations: [{ agent: 'checker', result: 'inconclusive' }] },
    { id: 'padded', agent: 'reader', validations: [{ agent: ' reader ', result: 'confirmed' }] },
    { id: 'unnamed', agent: ' ', validations: [{ agent: 'reader', result: 'confirmed' }] },
    { id: 'asset', kind: 'module' }
  ] }))
  assert.equal(coverage(graph, 'nodes').indexed, 6)
  assert.equal(coverage(graph, 'nodes').validated, 0)
  assert.equal(graph.nodes.get('only-review').review, undefined)
})

test('graph filters combine node attributes, relationship state, analysts and validators', () => {
  const open = filterGraph(current, { symbol: 'LOOK', status: 'validated', language: 'TypeScript',
    file: 'src/catalog.ts', agent: 'verifier', type: 'delegates', unresolved: true })
  assert.deepEqual(nodeIds(open), ['lookup'])
  assert.deepEqual(edgeIds(open), ['lookup-fallback'])
  assert.deepEqual(nodeIds(filterGraph(current, { language: 'Python' })), ['metrics'])
  assert.deepEqual(nodeIds(filterGraph(current, { type: 'calls', unresolved: true })), [])
  assert.deepEqual(nodeIds(filterGraph(current, { isolate: true }, { table: 'nodes', id: 'lookup' })), ['index', 'lookup'])
  assert.deepEqual(nodeIds(filterGraph(current, { isolate: true }, { table: 'chains', id: 'book-request' })), ['index', 'lookup'])
})

test('parallel relationships keep distinct identities in projections and run comparisons', () => {
  const run = parse({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [
    { id: 'fast', source: 'a', target: 'b' }, { id: 'slow', source: 'a', target: 'b' }
  ], chains: [{ id: 'fast-route', members: ['a', 'b'], relationships: ['fast'], agent: 'route analyst',
    validations: [{ agent: 'route validator', result: 'confirmed' }] }],
  events: [{ relationships: [{ id: 'slow', status: 'unresolved', reason: 'No fixture' }] }] })
  const after = snapshotAt(run)
  assert.deepEqual(edgeIds(filterGraph(after, { unresolved: true })), ['slow'])
  assert.deepEqual(edgeIds(filterGraph(after, { isolate: true }, { table: 'chains', id: 'fast-route' })), ['fast'])
  assert.deepEqual(edgeIds(filterGraph(after, { agent: 'route analyst' })), ['fast'])
  assert.deepEqual(nodeIds(filterGraph(after, { agent: 'route validator' })), ['a', 'b'])
  assert.deepEqual(compareGraphs(snapshotAt(run, 0), after).map(r => [r.id, r.fields]), [['slow', ['status', 'reason']]])
  const changes = compareGraphs(previous, current)
  assert.ok(changes.some(r => r.change === 'Removed' && r.id === 'legacy'))
  assert.ok(changes.some(r => r.change === 'Added' && r.id === 'metrics'))
  assert.ok(changes.some(r => r.table === 'evidence' && r.id === 'lookup-test'))
  assert.deepEqual(compareGraphs(current, current), [])
})

test('Mermaid export uses safe aliases and includes human annotations while source observations stay intact', () => {
  const id = '__proto__'
  const run = parse({ nodes: [{ id, symbol: 'read("item") [fallback]', file: 'src/read.ts', line: 7 }] })
  const view = filterGraph(snapshotAt(run))
  const compiled = toMermaid(view)
  assert.equal(compiled.originalIds.get('n0'), id)
  assert.ok(!compiled.diagram.includes('__proto__'))
  assert.ok(!compiled.diagram.includes('read("item")'))
  const reviews = new Map([[JSON.stringify(['nodes', id]), { notes: 'Checked "item".\nNext line', references: 'test/read.ts:2' }]])
  const restored = readAnnotations(exportMermaid(view, compiled, reviews))
  assert.deepEqual(restored.records.get('n0'), { references: 'src/read.ts:7\ntest/read.ts:2', notes: 'Checked "item".\nNext line' })
  assert.equal(run.initial.nodes[0].notes, undefined)
})

test('invalid references, duplicate identities, unsafe URLs and invalid events are rejected before import', () => {
  assert.throws(() => parse({ nodes: [{ id: 'dup' }, { id: 'dup' }] }), /Duplicate nodes/)
  assert.throws(() => parse({ nodes: [{ id: 'a', evidence: ['missing'] }] }), /Unknown evidence/)
  assert.throws(() => parse({ nodes: [{ id: 'a' }], edges: [{ source: 'a', target: 'b' }] }), /unknown node/)
  assert.throws(() => parse({ nodes: [], evidence: [{ id: 'bad', url: 'file:///local.txt' }] }), /http/)
  assert.throws(() => parse({ nodes: [], chains: [{ id: 'chain', members: ['missing'] }] }), /Unknown node/)
  assert.throws(() => parse({ nodes: [{ id: 'a' }], events: [{ nodes: [{ id: 'a', file: 'f', line: -1 }] }] }), /Event 1/)
  assert.throws(() => parse({ nodes: [], events: [{ at: '2026-02-02' }, { at: '2026-02-01' }] }), /chronological/)
  assert.throws(() => parse({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ source: 'a', target: 'b' }],
    events: [{ remove: { nodes: ['b'] } }] }), /Event 1.*unknown node/)
})
