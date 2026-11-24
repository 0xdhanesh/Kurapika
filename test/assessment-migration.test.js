import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAssessment } from '../src/assessment-format.js'
import { getRunIndex, importRuns, listReviews, getRun } from '../src/assessment-store.js'

test('an assessment saved before paging migrates without losing evidence or reviews', async () => {
  const [run] = parseAssessment(JSON.stringify({ repository: 'old', runId: 'one', nodes: [{ id: 'a' }],
    evidence: [{ id: 'e', detail: 'old text'.repeat(40000) }] }))
  const review = { repository: 'old', table: 'nodes', id: 'a', decision: 'disputed' }
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('kurapika-assessments', 1)
    req.onupgradeneeded = () => {
      const db = req.result
      const keyPath = ['repository', 'runId']
      db.createObjectStore('runs', { keyPath }).add(run)
      db.createObjectStore('catalog', { keyPath }).add({ repository: 'old', runId: 'one', importedAt: '2026-01-01' })
      const reviews = db.createObjectStore('reviews', { autoIncrement: true })
      reviews.createIndex('repository', 'repository')
      reviews.add(review)
    }
    req.onerror = () => reject(req.error)
    req.onsuccess = () => { req.result.close(); resolve() }
  })
  await importRuns([await getRunIndex('old', 'one')])
  assert.equal((await getRunIndex('old', 'one')).paged, true)
  assert.deepEqual(await getRun('old', 'one'), run)
  assert.deepEqual(await listReviews('old'), [review])
})
