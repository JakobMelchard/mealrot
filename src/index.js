// Worker for mealrot: the Sunday cron and /plan in the Telegram chat each send a meal-prep suggestion.
import { KEEP, LIMITS, plan } from './planner.js'
import { search } from './spoon.js'

/** @typedef {import('./planner.js').Recipe} Recipe */
/**
 * @typedef {object} Env
 * @property {KVBinding} MEALROT_KV plan history
 * @property {string} TELEGRAM_TOKEN bot token
 * @property {string} TELEGRAM_CHAT_ID the one chat allowed to talk to the bot
 * @property {string} WEBHOOK_SECRET secret_token given to setWebhook
 * @property {string} SPOONACULAR_API_KEY Spoonacular API key
 */

/**
 * @param {Env} env bindings
 * @param {string} text message
 * @returns {Promise<void>}
 */
const say = async (env, text) => {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
    signal: AbortSignal.timeout(15e3),
  })
  if (!r.ok) throw new Error(`telegram: ${r.status} ${await r.text()}`)
}

/**
 * One meal's message; its link is the only one, so Telegram previews it.
 * @param {Recipe} r recipe
 * @param {number} i slot, 0-based
 * @returns {string} Telegram message
 */
export const meal = (r, i) => {
  const m = r.macros
  return `${i + 1}. ${r.name}: ${Math.round(m.kcal)} kcal, ${Math.round(m.protein)}P/${Math.round(m.carbs)}C/${Math.round(m.fat)}F per portion (6 portions)\n${r.url}`
}

/**
 * Research, pick and send a plan; the picks join the history once sent.
 * @param {Env} env bindings
 * @returns {Promise<void>}
 */
export const suggest = async (env) => {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
  /** @type {string[][]} */
  const hist = JSON.parse((await env.MEALROT_KV.get('history')) ?? '[]')
  /** @type {Recipe[]} */
  let pool
  try {
    pool = await search(env.SPOONACULAR_API_KEY, LIMITS, seed)
  } catch (e) {
    return say(env, `Research failed: ${e instanceof Error ? e.message : e}`)
  }
  const picks = plan(pool, LIMITS, hist, seed)
  if (!picks.length) return say(env, 'No recipe passes the protein/kcal filter')
  for (const [i, r] of picks.entries()) await say(env, meal(r, i))
  await env.MEALROT_KV.put(
    'history',
    JSON.stringify([...hist, picks.map((r) => r.name)].slice(-KEEP)),
  )
}

export default {
  /**
   * Telegram webhook: /plan sends a suggestion, /start says when the next one comes. The
   * work runs after the 200 so Telegram does not retry a slow search.
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
    const m = /** @type {{message?: {chat?: {id: number}, text?: string}}} */ (await request.json())
      .message
    if (String(m?.chat?.id) === env.TELEGRAM_CHAT_ID) {
      const cmd = (m?.text ?? '').trim().split(/\s+/)[0]?.split('@')[0]
      const job =
        cmd === '/plan'
          ? suggest(env)
          : cmd === '/start'
            ? say(env, 'Suggestions come Sundays 16:00 UTC. /plan sends one now.')
            : null
      if (job) ctx.waitUntil(job.catch((e) => console.error(`${cmd}: ${e}`)))
    }
    return new Response('ok')
  },

  /**
   * @param {unknown} _event cron event
   * @param {Env} env
   * @returns {Promise<void>}
   */
  scheduled: (_event, env) => suggest(env),
}
