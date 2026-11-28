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
/** @type {{method: string, body: {text?: string, message_id?: number, reply_markup?: {inline_keyboard: {callback_data: string}[][]}}}[]} */
let calls
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
    const body = JSON.parse(String(init?.body))
    const method = String(url).split('/').pop() ?? ''
    calls.push({ method, body })
    if (method === 'sendMessage') sent.push(body.text)
    return Response.json({ ok: true, result: { message_id: 100 + sent.length } })
  }
)
test.after(() => {
  globalThis.fetch = real
})
test.beforeEach(() => {
  kv = {}
  sent = []
  calls = []
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

/** Three eligible results, so a plan of two leaves one for a reroll. */
const plan = async () => {
  await hook(msg('/plan'))
  calls = []
  sent = []
}
const press = (/** @type {string} */ data, id = 101) => ({
  callback_query: { id: 'cb', data, message: { chat: { id: 42 }, message_id: id } },
})

test('reroll swaps the meal in place and keeps the other', async () => {
  await plan()
  const before = JSON.parse(kv.current ?? '{}').picks.map(
    (/** @type {{name: string}} */ x) => x.name,
  )
  await hook(press('reroll:1'))
  const edit = calls.find((c) => c.method === 'editMessageText')
  assert.equal(edit?.body.message_id, 101)
  assert.equal(sent.length, 0)
  const after = JSON.parse(kv.current ?? '{}').picks.map(
    (/** @type {{name: string}} */ x) => x.name,
  )
  assert.notEqual(after[0], before[0])
  assert.equal(after[1], before[1])
  assert.deepEqual(JSON.parse(kv.history ?? '[]').at(-1), after)
})

test('/reroll 2 swaps slot 2, a bad slot is refused', async () => {
  await plan()
  await hook(msg('/reroll 2'))
  assert.equal(calls.find((c) => c.method === 'editMessageText')?.body.message_id, 102)
  await hook(msg('/reroll 9'))
  assert.deepEqual(sent, ['Slot must be 1-2'])
})

test('/reroll without a plan says so', async () => {
  await hook(msg('/reroll'))
  assert.match(sent[0] ?? '', /No plan yet/)
})

test('save stores the recipe once and joins later plans', async () => {
  await plan()
  await hook(press('save:1'))
  await hook(press('save:1'))
  const saved = JSON.parse(kv.saved ?? '[]')
  assert.equal(saved.length, 1)
  assert.equal(
    calls.filter((c) => c.method === 'answerCallbackQuery')[0]?.body.text,
    `Saved ${saved[0].name}`,
  )
})

test('a button on an old message is refused', async () => {
  await plan()
  await hook(press('reroll:1', 5))
  assert.equal(
    calls.some((c) => c.method === 'editMessageText'),
    false,
  )
  assert.match(calls.at(-1)?.body.text ?? '', /Plan replaced/)
})

test('buttons from another chat are ignored', async () => {
  await plan()
  await hook({
    callback_query: { id: 'x', data: 'reroll:1', message: { chat: { id: 7 }, message_id: 101 } },
  })
  assert.deepEqual(calls, [])
})

test('planner parameters are configurable via env vars', async () => {
  const orig = globalThis.fetch
  /** @type {string[]} */
  const urls = []
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (url, init) => {
      if (String(url).startsWith('https://api.spoonacular.com')) {
        urls.push(String(url))
        return Response.json({
          results: [
            { ...result('One'), nutrition: { nutrients: [{ name: 'Calories', amount: 800 }, { name: 'Protein', amount: 40 }] } },
            { ...result('Two'), nutrition: { nutrients: [{ name: 'Calories', amount: 800 }, { name: 'Protein', amount: 40 }] } },
          ],
        })
      }
      const body = JSON.parse(String(init?.body))
      const method = String(url).split('/').pop() ?? ''
      calls.push({ method, body })
      if (method === 'sendMessage') sent.push(body.text)
      return Response.json({ ok: true, result: { message_id: 100 + sent.length } })
    }
  )
  try {
    kv = { history: JSON.stringify([['h1'], ['h2']]) }
    waiting = []
    const custom = {
      ...env,
      KCAL: '800',
      KCAL_TOLERANCE: '0.25',
      PROTEIN_MIN: '30',
      WEEKLY_RECIPES: '1',
      PORTIONS: '4',
      HISTORY_KEEP: '1',
    }
    const res = await worker.fetch(
      new Request('https://x.test/', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': 's' },
        body: JSON.stringify(msg('/plan')),
      }),
      custom,
      ctx,
    )
    await Promise.all(waiting)
    assert.equal(res.status, 200)
    const q = new URL(urls[0] ?? '').searchParams
    assert.equal(q.get('minProtein'), '30')
    assert.equal(q.get('minCalories'), '600')
    assert.equal(q.get('maxCalories'), '1000')
    assert.equal(sent.length, 1)
    assert.match(sent[0] ?? '', /\(4 portions\)/)
    assert.equal(JSON.parse(kv.history ?? '[]').length, 1)
  } finally {
    globalThis.fetch = orig
  }
})
