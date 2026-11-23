import test from 'node:test'
import assert from 'node:assert/strict'
import { readDraft, saveDraft } from '../src/draft.js'

test('restores the active filename and draft, including an intentionally empty editor', t => {
  const entries = new Map()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete globalThis.localStorage
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, value: {
      getItem: key => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value)
    }
  })
  assert.equal(readDraft(), null)
  for (const source of ['flowchart TD\nA-->', '']) {
    assert.ok(saveDraft('review.mmd', source))
    assert.deepEqual(readDraft(), { file: 'review.mmd', source })
  }
})
