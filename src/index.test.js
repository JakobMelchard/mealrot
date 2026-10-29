// Tests the mealrot Worker: webhook auth, commands, the cron, and the history it keeps.
// fetch and KV are stubs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from './index.js'

const result = (/** @type {string} */ title) => ({
  id: 1,
  title,
  nutrition: {
    nutrients: [
      { name: 'Calories', amount: 650 },
      { name: 'Protein', amount: 45 },
    ],
  },
  sourceUrl: `https://blog.test/${title}`,
})

/** @type {Record<string, string>} */
let kv
/** @type {string[]} */
let sent
let spoon = 200
const env = /** @type {import('./index.js').Env} */ ({
  MEALROT_KV: {
    get: async (k) => kv[k] ?? null,
    put: async (k, v) => void (kv[k] = v),
  },
  TELEGRAM_TOKEN: 't',
  TELEGRAM_CHAT_ID: '42',
  WEBHOOK_SECRET: 's',
  SPOONACULAR_API_KEY: 'k',
})
const real = globalThis.fetch
globalThis.fetch = /** @type {typeof fetch} */ (
  async (url, init) => {
    if (String(url).startsWith('https://api.spoonacular.com'))
      return spoon === 200
        ? Response.json({ results: [result('Alpha'), result('Beta'), result('Gamma')] })
        : new Response('', { status: spoon })
    sent.push(JSON.parse(String(init?.body)).text)
    return Response.json({ ok: true })
  }
)
test.after(() => {
  globalThis.fetch = real
})
test.beforeEach(() => {
  kv = {}
  sent = []
  spoon = 200
})

/** @type {Promise<unknown>[]} */
let waiting = []
const ctx = {
  waitUntil: (/** @type {Promise<unknown>} */ p) => void waiting.push(p),
  passThroughOnException() {},
}

/**
 * @param {unknown} body
 * @param {string} [secret]
 * @returns {Promise<Response>}
 */
const hook = async (body, secret = 's') => {
  waiting = []
  const res = await worker.fetch(
    new Request('https://x.test/', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': secret },
      body: JSON.stringify(body),
    }),
    env,
    ctx,
  )
  await Promise.all(waiting)
  return res
}
const msg = (/** @type {string} */ text, id = 42) => ({ message: { chat: { id }, text } })

test('a wrong secret or method is a 404', async () => {
  assert.equal((await hook(msg('/plan'), 'nope')).status, 404)
  const get = await worker.fetch(new Request('https://x.test/'), env, ctx)
  assert.equal(get.status, 404)
  assert.deepEqual(sent, [])
})

test('/plan sends one message per meal and stores the history', async () => {
  assert.equal((await hook(msg('/plan'))).status, 200)
  assert.equal(sent.length, 2)
  assert.match(
    sent[0] ?? '',
    /^1\. \w+: 650 kcal, 45P\/0C\/0F per portion \(6 portions\)\nhttps:\/\/blog\.test\//,
  )
  assert.equal(JSON.parse(kv.history ?? '[]').length, 1)
  assert.equal(JSON.parse(kv.history ?? '[]')[0].length, 2)
})

test('/plan@botname works, other chats and text are ignored', async () => {
  await hook(msg('/plan@mealrot_bot'))
  assert.equal(sent.length, 2)
  sent = []
  await hook(msg('/plan', 7))
  await hook(msg('hello'))
  assert.deepEqual(sent, [])
})

test('/start names the schedule', async () => {
  await hook(msg('/start'))
  assert.match(sent[0] ?? '', /Sundays 16:00 UTC/)
})

test('the cron sends a suggestion', async () => {
  await worker.scheduled(null, env)
  assert.equal(sent.length, 2)
})

test('a failed search is reported and leaves the history alone', async () => {
  spoon = 402
  await worker.scheduled(null, env)
  assert.deepEqual(sent, ['Research failed: spoonacular: 402'])
  assert.equal(kv.history, undefined)
})

test('history keeps the last three plans', async () => {
  kv.history = JSON.stringify([['a'], ['b'], ['c']])
  await worker.scheduled(null, env)
  const h = JSON.parse(kv.history ?? '[]')
  assert.equal(h.length, 3)
  assert.deepEqual(h[0], ['b'])
})
