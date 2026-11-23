import test from 'node:test'
import assert from 'node:assert/strict'
import { createTracer } from '../src/trace.js'

function arrow(id, start, end, extra = {}) {
  return { id, start, end, arrowTypeStart: 'none', arrowTypeEnd: 'arrow_point', ...extra }
}

test('a forward trace includes the closing edge of a cycle and a self-loop', () => {
  const trace = createTracer([arrow('ab', 'A', 'B'), arrow('ba', 'B', 'A'), arrow('bb', 'B', 'B')])
  const { reached, active } = trace('A', 'forward')
  assert.deepEqual(reached, new Set(['A', 'B']))
  assert.deepEqual(active, new Set(['ab', 'ba', 'bb']))
})

test('parallel edges keep distinct IDs and animate in reverse on a backward trace', () => {
  const trace = createTracer([arrow('first', 'A', 'B'), arrow('second', 'A', 'B')])
  const { active, reverse } = trace('B', 'backward')
  assert.deepEqual(active, new Set(['first', 'second']))
  assert.deepEqual(reverse, active)
})

test('directions follow marked endpoints and immediate mode stops after one hop', () => {
  const trace = createTracer([
    arrow('ab', 'A', 'B'), arrow('bc', 'B', 'C'), arrow('cd', 'C', 'D'),
    arrow('eb', 'E', 'B', { arrowTypeStart: 'arrow_point' }),
    arrow('bf', 'B', 'F', { arrowTypeEnd: 'none' }),
    arrow('bg', 'B', 'G', { thickness: 'invisible' })
  ])
  assert.deepEqual(trace('B', 'forward').reached, new Set(['B','C','D','E']))
  assert.deepEqual(trace('B', 'backward').reached, new Set(['A','B','E']))
  assert.deepEqual(trace('B', 'immediate').reached, new Set(['A','B','C','E','F','G']))
})
