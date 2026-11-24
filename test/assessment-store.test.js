import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAssessment, snapshotAt } from '../src/assessment-format.js'
import { importFiles, importAssessmentText } from '../src/assessment-import.js'
import { getRun, importRuns, listReviews, listRuns, saveReview } from '../src/assessment-store.js'

function sample(repository, runId, extra = {}) {
  return parseAssessment(JSON.stringify({ repository, runId, nodes: [{ id: 'lookup', status: 'indexed' }], ...extra }))[0]
}

test('an import can append events, and retrying the original preserves progress and human reviews', async () => {
  const repository = 'library'
  const base = sample(repository, 'first')
  await importRuns([base])
  const decision = { repository, table: 'nodes', id: 'lookup', runId: 'first', step: 0, decision: 'disputed',
    references: 'lookup.js:10', notes: 'Check the adapter.', at: '2026-06-02T12:00:00Z' }
  await saveReview(decision)
  const extension = sample(repository, 'first', {
    evidence: [{ id: 'site', label: 'Call site' }],
    events: [{ agent: 'reader', nodes: [{ id: 'lookup', status: 'analyzed', evidence: ['site'] }] }]
  })
  await importRuns([extension, base, extension])
  assert.deepEqual(await getRun(repository, 'first'), extension)
  const later = sample(repository, 'second', {
    nodes: [{ id: 'lookup', status: 'validated', humanReview: 'reviewed' }],
    reviews: [{ ...decision, decision: 'reviewed' }], chains: [{ id: 'lookup', members: ['lookup'] }]
  })
  await importRuns([later])
  assert.equal(snapshotAt(await getRun(repository, 'second')).nodes.get('lookup').humanReview, undefined)
  assert.deepEqual(await listReviews(repository), [decision])
  const chainDecision = { ...decision, runId: 'second', table: 'chains', decision: 'needs-investigation' }
  const update = { ...decision, runId: 'second', decision: 'reviewed' }
  await saveReview(chainDecision)
  await saveReview(update)
  assert.deepEqual(await listReviews(repository), [decision, chainDecision, update])
  assert.deepEqual(await listReviews('another repository'), [])
})

test('a conflict rolls back the entire import, including run metadata', async () => {
  const first = sample('batch', 'existing')
  await importRuns([first])
  const extra = sample('batch', 'new')
  const conflict = sample('batch', 'existing', { nodes: [{ id: 'lookup', status: 'blocked' }] })
  await assert.rejects(importRuns([extra, conflict]), /already exists/)
  assert.equal(await getRun('batch', 'new'), undefined)
  assert.deepEqual((await listRuns()).filter(row => row.repository === 'batch').map(row => row.runId), ['existing'])
  assert.deepEqual(await getRun('batch', 'existing'), first)
})

test('concurrent conflicting imports retain one consistent history', async () => {
  const a = sample('parallel', 'run', { events: [{ summary: 'first observation' }] })
  const b = sample('parallel', 'run', { events: [{ summary: 'other observation' }] })
  const attempts = await Promise.allSettled([importRuns([a]), importRuns([b])])
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1)
  assert.deepEqual(await getRun('parallel', 'run'), attempts[0].status === 'fulfilled' ? a : b)
})

test('runs with the same timestamp retain their import order across retries', async () => {
  const at = '2026-06-01T00:00:00Z'
  const older = sample('tied', 'z-original', { at })
  const newer = sample('tied', 'a-followup', { at })
  await importRuns([older, newer, older])
  assert.deepEqual((await listRuns()).filter(run => run.repository === 'tied').map(run => run.runId), ['a-followup', 'z-original'])
})

test('large evidence survives file and pasted assessment imports intact', async () => {
  const detail = 'A'.repeat(2_000_001)
  const data = { repository: 'large', nodes: [{ id: 'f', evidence: ['record'] }], evidence: [{ id: 'record', detail }] }
  const json = JSON.stringify(data)
  await importFiles([new File([json], 'file.json')])
  await importAssessmentText(json, 'pasted')
  for (const id of ['file', 'pasted']) {
    const graph = snapshotAt(await getRun('large', id))
    assert.equal(graph.evidence.get('record').detail, detail)
  }
  await assert.rejects(importFiles([new File(['{}'], 'invalid.json')]), /^Error: invalid\.json: A graph requires a nodes array/)
})
