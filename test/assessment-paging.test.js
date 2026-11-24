import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { graphAreas, isPagedText } from '../src/assessment-pages.js'
import { importFiles } from '../src/assessment-import.js'
import { getRun, getRunIndex, stageCursor, readTextPage } from '../src/assessment-store.js'

test('bounded connected areas retain parallel edges, open ends and disconnected nodes', () => {
  const nodes = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }))
  const edges = Array.from({ length: 400 }, (_, i) => ({ id: String(i), source: '0', target: i % 17 === 0 ? null : String(i % 80) }))
  const areas = graphAreas({ nodes, edges }, '9')
  const seen = new Set(), visited = new Set()
  const first = areas.get(0)
  assert.ok(first.nodes.some(n => n.id === '9'))
  for (let i = 0; ; i++) {
    const page = areas.get(i), ids = new Set(page.nodes.map(n => n.id))
    assert.ok(ids.size <= 32 && page.edges.length <= 64)
    for (const id of ids) visited.add(id)
    for (const edge of page.edges) {
      assert.ok(ids.has(edge.source) && (edge.target === null || ids.has(edge.target)))
      assert.ok(!seen.has(edge.id))
      seen.add(edge.id)
    }
    if (!page.hasNext) break
  }
  assert.equal(seen.size, edges.length)
  assert.equal(visited.size, nodes.length)
  assert.deepEqual(areas.get(0), first)
})

test('a streamed file over 10k edges reopens with paged text and seekable stages', async () => {
  const detail = 'catalog 📚'.repeat(200000)
  const data = { repository: 'pages', runId: 'one', nodes: [{ id: 'a' }, { id: 'b' }],
    evidence: [{ id: 'book', detail }], relationships: Array.from({ length: 10001 }, (_, i) => ({ id: String(i), source: 'a', target: 'b' })),
    events: Array.from({ length: 68 }, (_, i) => ({ nodes: [{ id: 'a', symbol: String(i) }] })) }
  const file = new File([JSON.stringify(data)], 'pages.json')
  file.text = () => { throw Error('Unexpected full-file text read') }
  await importFiles([file])
  const index = await getRunIndex('pages', 'one')
  assert.equal(index.events.length, 0)
  assert.equal(index.eventCount, 68)
  const cursor = stageCursor(index)
  assert.equal((await cursor.seek(64)).graph.nodes.get('a').symbol, '63')
  assert.equal((await cursor.seek(3)).graph.nodes.get('a').symbol, '2')
  const first = (await cursor.seek(0)).graph
  assert.equal(first.relationships.size, 10001)
  const ref = first.evidence.get('book').detail
  assert.ok(isPagedText(ref))
  assert.equal(await readTextPage(ref.textPages[0]), detail.slice(0, 16384))
  await importFiles([file])
  assert.equal((await getRun('pages', 'one')).evidence[0].detail, detail)
})

test('one large stage is deferred, survives append, and rewinds cleanly', async () => {
  const data = { repository: 'few', runId: 'large-stage', nodes: [],
    events: [{ nodes: Array.from({ length: 1600 }, (_, i) => ({ id: String(i) })) }] }
  const importData = () => importFiles([new File([JSON.stringify(data)], 'stage.json')])
  await importData()
  const original = await getRunIndex('few', 'large-stage')
  assert.equal(original.eventCount, 1)
  assert.deepEqual(original.events, [])
  const cursor = stageCursor(original)
  assert.equal((await cursor.seek(0)).graph.nodes.size, 0)
  assert.equal((await cursor.seek(1)).graph.nodes.size, 1600)
  data.events.push({ remove: { nodes: data.events[0].nodes.map(n => n.id) } })
  await importData()
  const later = stageCursor(await getRunIndex('few', 'large-stage'))
  assert.equal((await later.seek(2)).graph.nodes.size, 0)
  assert.equal((await later.seek(1)).graph.nodes.size, 1600)
})
