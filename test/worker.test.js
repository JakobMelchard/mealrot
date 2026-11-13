import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../src/worker.js'

test('GET / answers', async () => {
  const res = await worker.fetch(new Request('http://x/'), {})
  assert.equal(res.status, 200)
  assert.equal(await res.text(), 'mealrot\n')
})

test('unknown paths are 404', async () => {
  const res = await worker.fetch(new Request('http://x/nope'), {})
  assert.equal(res.status, 404)
})
