import assert from 'node:assert/strict'
import test from 'node:test'
import { chooseEntryId } from '../src/inspect.js'

test('the entry class picks the function start when several sources exist', () => {
  const nodes = [
    { id: 'note', entry: false },
    { id: 'main', entry: true },
    { id: 'later', entry: true }
  ]
  const edges = [{ start: 'main', end: 'later' }]
  assert.equal(chooseEntryId(nodes, edges), 'main')
})

test('an unmarked source is the function start', () => {
  const nodes = [
    { id: 'setup', entry: false },
    { id: 'main', entry: false },
    { id: 'helper', entry: true }
  ]
  const edges = [
    { start: 'setup', end: 'helper' },
    { start: 'main', end: 'setup' }
  ]
  assert.equal(chooseEntryId(nodes, edges), 'main')
})

test('the earliest source wins when none is marked', () => {
  const nodes = [
    { id: 'alpha', entry: false },
    { id: 'beta', entry: false }
  ]
  assert.equal(chooseEntryId(nodes, []), 'alpha')
})

test('a cycle falls back to the marked node, then the first node', () => {
  const nodes = [
    { id: 'a', entry: false },
    { id: 'b', entry: true }
  ]
  const edges = [{ start: 'a', end: 'b' }, { start: 'b', end: 'a' }]
  assert.equal(chooseEntryId(nodes, edges), 'b')
  assert.equal(chooseEntryId(nodes.map(node => ({ ...node, entry: false })), edges), 'a')
})

test('subgraph clusters are not entry points', () => {
  const nodes = [
    { id: 'group', entry: true, cluster: true },
    { id: 'main', entry: false }
  ]
  assert.equal(chooseEntryId(nodes, []), 'main')
  assert.equal(chooseEntryId([], []), null)
})
