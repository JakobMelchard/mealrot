// Worker for mealrot: the Sunday cron and /plan in the Telegram chat each send a meal-prep suggestion.
import { config, LIMITS, plan, reroll } from './planner.js'
import { search } from './spoon.js'

/** @typedef {import('./planner.js').Recipe} Recipe */
/**
 * @typedef {object} Env
 * @property {KVBinding} MEALROT_KV plan history, current plan, saved recipes
 * @property {string} TELEGRAM_TOKEN bot token
 * @property {string} TELEGRAM_CHAT_ID the one chat allowed to talk to the bot
 * @property {string} WEBHOOK_SECRET secret_token given to setWebhook
 * @property {string} SPOONACULAR_API_KEY Spoonacular API key
 * @property {string | number} [KCAL] target kcal per portion
 * @property {string | number} [KCAL_TOLERANCE] kcal tolerance fraction
 * @property {string | number} [PROTEIN_MIN] minimum protein g per portion
 * @property {string | number} [PROTEIN_TARGET] target protein g per portion
 * @property {string | number} [WEEKLY_RECIPES] recipes per plan
 * @property {string | number} [PORTIONS] portions per recipe
 * @property {string | number} [HISTORY_KEEP] recent plans to avoid repeating
 */
/** @typedef {{picks: Recipe[], pool: Recipe[], ids: number[]}} Current the latest plan, this search's candidates, its message ids */
/** @typedef {{message_id?: number, chat?: {id: number}, text?: string}} TgMessage */
/** @typedef {{message?: TgMessage, callback_query?: {id: string, data?: string, message?: TgMessage}}} Update */

/**
 * @template T
 * @param {Env} env bindings
 * @param {string} key KV key
 * @param {T} fallback value when unset
 * @returns {Promise<T>} parsed value
 */
const load = async (env, key, fallback) =>
  JSON.parse((await env.MEALROT_KV.get(key)) ?? 'null') ?? fallback

/**
 * @param {Env} env bindings
 * @returns {Promise<Current | null>} the latest plan, null before the first
 */
const current = async (env) =>
  /** @type {Current | null} */ (JSON.parse((await env.MEALROT_KV.get('current')) ?? 'null'))

/**
 * @param {Env} env bindings
 * @param {string} method Bot API method
 * @param {Record<string, unknown>} body parameters
 * @returns {Promise<unknown>} Telegram's result
 */
const tg = async (env, method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15e3),
  })
  const j = /** @type {{ok: boolean, result: unknown, description?: string}} */ (await r.json())
  if (!j.ok) throw new Error(`${method}: ${j.description}`)
  return j.result
}

/**
 * @param {Env} env bindings
 * @param {string} text message
 * @param {unknown} [markup] reply_markup
 * @returns {Promise<{message_id: number}>} the sent message
 */
const say = (env, text, markup) =>
  /** @type {Promise<{message_id: number}>} */ (
    tg(env, 'sendMessage', { chat_id: env.TELEGRAM_CHAT_ID, text, reply_markup: markup })
  )

/**
 * One meal's message; its link is the only one, so Telegram previews it.
 * @param {Recipe} r recipe
 * @param {number} i slot, 0-based
 * @param {number} [portions] portions per recipe
 * @returns {string} Telegram message
 */
export const meal = (r, i, portions = LIMITS.portions) => {
  const m = r.macros
  return `${i + 1}. ${r.name}: ${Math.round(m.kcal)} kcal, ${Math.round(m.protein)}P/${Math.round(m.carbs)}C/${Math.round(m.fat)}F per portion (${portions} portions)\n${r.url}`
}

/**
 * @param {number} i slot, 0-based
 * @returns {{inline_keyboard: {text: string, callback_data: string}[][]}} reroll and save buttons
 */
const keys = (i) => ({
  inline_keyboard: [
    [
      { text: 'Reroll', callback_data: `reroll:${i + 1}` },
      { text: 'Save', callback_data: `save:${i + 1}` },
    ],
  ],
})

/**
 * Research, pick and send a plan from this search and the saved recipes; the picks join
 * the history once sent.
 * @param {Env} env bindings
 * @returns {Promise<void>}
 */
export const suggest = async (env) => {
  const c = config(env)
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
  /** @type {string[][]} */
  const hist = await load(env, 'history', [])
  /** @type {Recipe[]} */
  let pool
  try {
    pool = await search(env.SPOONACULAR_API_KEY, c, seed)
  } catch (e) {
    await say(env, `Research failed: ${e instanceof Error ? e.message : e}`)
    return
  }
  const picks = plan([...pool, ...(await load(env, 'saved', []))], c, hist, seed)
  if (!picks.length) {
    await say(env, 'No recipe passes the protein/kcal filter')
    return
  }
  const ids = []
  for (const [i, r] of picks.entries())
    ids.push((await say(env, meal(r, i, c.portions), keys(i))).message_id)
  await env.MEALROT_KV.put('current', JSON.stringify({ picks, pool, ids }))
  await env.MEALROT_KV.put(
    'history',
    JSON.stringify([...hist, picks.map((r) => r.name)].slice(-c.historyKeep)),
  )
}

/**
 * Swap pick n (1-based) of the latest plan, random if omitted, and edit its message.
 * No new search: candidates are that plan's search and the saved recipes.
 * @param {Env} env bindings
 * @param {number | undefined} n slot
 * @returns {Promise<void>}
 */
const swap = async (env, n) => {
  const c = config(env)
  const cur = await current(env)
  if (!cur) return void (await say(env, 'No plan yet. /plan makes one.'))
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
  const slot = n === undefined ? seed % cur.picks.length : n - 1
  if (!Number.isInteger(slot) || !cur.picks[slot])
    return void (await say(env, `Slot must be 1-${cur.picks.length}`))
  /** @type {string[][]} */
  const hist = await load(env, 'history', [])
  const picks = reroll(
    [...cur.pool, ...(await load(env, 'saved', []))],
    c,
    hist.slice(0, -1),
    cur.picks,
    slot,
    seed,
  )
  if (!picks) return void (await say(env, 'No alternative recipe available.'))
  const r = /** @type {Recipe} */ (picks[slot])
  await tg(env, 'editMessageText', {
    chat_id: env.TELEGRAM_CHAT_ID,
    message_id: cur.ids[slot],
    text: meal(r, slot, c.portions),
    reply_markup: keys(slot),
  })
  await env.MEALROT_KV.put('current', JSON.stringify({ ...cur, picks }))
  await env.MEALROT_KV.put(
    'history',
    JSON.stringify([...hist.slice(0, -1), picks.map((x) => x.name)]),
  )
}

/**
 * Keep pick n (1-based) of the latest plan for later plans.
 * @param {Env} env bindings
 * @param {number} n slot
 * @returns {Promise<string>} what to tell the button
 */
const keep = async (env, n) => {
  const cur = await current(env)
  const r = cur?.picks[n - 1]
  if (!r) return 'No such recipe'
  /** @type {Recipe[]} */
  const saved = await load(env, 'saved', [])
  if (!saved.some((x) => x.name === r.name))
    await env.MEALROT_KV.put('saved', JSON.stringify([...saved, r]))
  return `Saved ${r.name}`
}

/**
 * One update from the chat: a command or a button press.
 * @param {Env} env bindings
 * @param {Update} u update
 * @returns {Promise<void>}
 */
const handle = async (env, u) => {
  const q = u.callback_query
  if (q) {
    if (String(q.message?.chat?.id) !== env.TELEGRAM_CHAT_ID) return
    const [act, n] = (q.data ?? '').split(':')
    const cur = await current(env)
    // buttons act only on the latest plan's messages
    if (!cur?.ids.includes(/** @type {number} */ (q.message?.message_id)))
      return void (await tg(env, 'answerCallbackQuery', {
        callback_query_id: q.id,
        text: 'Plan replaced, use the latest messages',
      }))
    const text = act === 'save' ? await keep(env, +(n ?? '')) : undefined
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text })
    if (act === 'reroll') await swap(env, +(n ?? ''))
    return
  }
  const m = u.message
  if (String(m?.chat?.id) !== env.TELEGRAM_CHAT_ID) return
  const [cmd = '', arg] = (m?.text ?? '').trim().split(/\s+/)
  const c = cmd.split('@')[0]
  if (c === '/plan') await suggest(env)
  else if (c === '/reroll') await swap(env, arg ? +arg : undefined)
  else if (c === '/start')
    await say(
      env,
      'Suggestions come Sundays 16:00 UTC. /plan sends one now, /reroll [n] swaps a meal.',
    )
}

export default {
  /**
   * Telegram webhook. The work runs after the 200 so Telegram does not retry a slow search.
   * @param {Request} request
   * @param {Env} env
   * @param {ExecutionContext} ctx
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    if (
      request.method !== 'POST' ||
      request.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET
    )
      return new Response('not found', { status: 404 })
    const u = /** @type {Update} */ (await request.json())
    ctx.waitUntil(handle(env, u).catch((e) => console.error(`update: ${e}`)))
    return new Response('ok')
  },

  /**
   * @param {unknown} _event cron event
   * @param {Env} env
   * @returns {Promise<void>}
   */
  scheduled: (_event, env) => suggest(env),
}
