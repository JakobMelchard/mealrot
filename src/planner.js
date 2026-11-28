// Picks the week's recipes: inside the macro limits, not seen in recent plans, varied in protein, cuisine and base.

/**
 * @typedef {object} Recipe
 * @property {string} name display name, unique
 * @property {{protein: string, cuisine: string, base: string}} tags rotation dimensions
 * @property {{kcal: number, protein: number, carbs: number, fat: number}} macros per portion
 * @property {string} url recipe page
 */
/**
 * @typedef {object} Config
 * @property {number} kcal per portion, accepted within +-kcalTolerance
 * @property {number} [kcalTolerance] fraction around kcal, in [0, 1)
 * @property {number} proteinMin g per portion
 * @property {number} proteinTarget g per portion
 * @property {number} weeklyRecipes recipes per plan
 * @property {number} [portions] portions printed per recipe message
 * @property {number} [historyKeep] recent plans avoided when picking recipes
 */
/**
 * @typedef {object} EnvLimits
 * @property {string | number} [KCAL]
 * @property {string | number} [KCAL_TOLERANCE]
 * @property {string | number} [PROTEIN_MIN]
 * @property {string | number} [PROTEIN_TARGET]
 * @property {string | number} [WEEKLY_RECIPES]
 * @property {string | number} [PORTIONS]
 * @property {string | number} [HISTORY_KEEP]
 */

export const KEEP = 3
/** @type {Required<Config>} */
export const LIMITS = {
  kcal: 650,
  kcalTolerance: 0.1,
  proteinMin: 35,
  proteinTarget: 45,
  weeklyRecipes: 2,
  portions: 6,
  historyKeep: KEEP,
}

const TAGS = /** @type {const} */ (['protein', 'cuisine', 'base'])
const TOP = 3

/**
 * @param {string | number | undefined} raw
 * @param {number} fallback
 * @param {(n: number) => boolean} ok
 * @returns {number}
 */
const num = (raw, fallback, ok) => {
  if (raw === undefined || String(raw).trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && ok(n) ? n : fallback
}

/**
 * @param {number} n candidate value
 * @returns {boolean} true when n is a positive integer
 */
const posInt = (n) => Number.isInteger(n) && n > 0

/**
 * Parse planner parameters from Worker env/vars, falling back to LIMITS on missing or invalid values.
 * @param {EnvLimits | undefined} env
 * @returns {Required<Config>}
 */
export const config = (env) => ({
  kcal: num(env?.KCAL, LIMITS.kcal, (n) => n > 0),
  kcalTolerance: num(env?.KCAL_TOLERANCE, LIMITS.kcalTolerance, (n) => n >= 0 && n < 1),
  proteinMin: num(env?.PROTEIN_MIN, LIMITS.proteinMin, (n) => n >= 0),
  proteinTarget: num(env?.PROTEIN_TARGET, LIMITS.proteinTarget, (n) => n >= 0),
  weeklyRecipes: num(env?.WEEKLY_RECIPES, LIMITS.weeklyRecipes, posInt),
  portions: num(env?.PORTIONS, LIMITS.portions, posInt),
  historyKeep: num(env?.HISTORY_KEEP, LIMITS.historyKeep, posInt),
})

/**
 * mulberry32 seeded random generator.
 * @param {number} a seed
 * @returns {() => number} uniform in [0, 1)
 */
export const rng = (a) => () => {
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
}

/**
 * @param {Recipe[]} rs recipes
 * @param {Config} c limits
 * @returns {Recipe[]} recipes with enough protein and kcal within tolerance of the target
 */
export const eligible = (rs, c) => {
  const tol = c.kcalTolerance ?? LIMITS.kcalTolerance
  return rs.filter(
    (r) => r.macros.protein >= c.proteinMin && Math.abs(r.macros.kcal - c.kcal) <= c.kcal * tol,
  )
}

/**
 * Minus the repeated tags against the picks so far, minus distance to the protein target.
 * @param {Recipe} r candidate
 * @param {Recipe[]} chosen picks so far
 * @param {Config} c limits
 * @returns {number} higher is better
 */
const score = (r, chosen, c) =>
  -TAGS.reduce((n, t) => n + chosen.filter((x) => x.tags[t] === r.tags[t]).length, 0) -
  Math.abs(r.macros.protein - c.proteinTarget) / 10

/**
 * Weighted sample among the best TOP by exp(score).
 * @param {Recipe[]} cands non-empty candidates
 * @param {Recipe[]} chosen picks so far
 * @param {Config} c limits
 * @param {() => number} rand random source
 * @returns {Recipe} the pick
 */
const pick = (cands, chosen, c, rand) => {
  const top = cands
    .map((r) => ({ r, s: score(r, chosen, c) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, TOP)
  const best = /** @type {{r: Recipe, s: number}} */ (top[0])
  const w = top.map((x) => Math.exp(x.s - best.s))
  let x = rand() * w.reduce((a, b) => a + b)
  return top.find((_, i) => (x -= /** @type {number} */ (w[i])) < 0)?.r ?? best.r
}

/**
 * @param {Recipe[]} rs candidates
 * @param {Config} c limits
 * @returns {Recipe[]} eligible recipes, first of each name
 */
const uniq = (rs, c) =>
  eligible(rs, c).filter((r, i, a) => a.findIndex((x) => x.name === r.name) === i)

/**
 * Pick `weeklyRecipes` eligible recipes. Names in the last KEEP plans are left out unless
 * too few others remain.
 * @param {Recipe[]} rs candidates
 * @param {Config} c limits
 * @param {string[][]} history recipe names per past plan, oldest first
 * @param {number} seed random seed
 * @returns {Recipe[]} picks, fewer when not enough pass the limits
 */
export const plan = (rs, c, history, seed) => {
  const rand = rng(seed)
  const keep = c.historyKeep ?? KEEP
  const used = new Set(history.slice(-keep).flat())
  const all = uniq(rs, c)
  const fresh = all.filter((r) => !used.has(r.name))
  const list = fresh.length >= c.weeklyRecipes ? fresh : all
  /** @type {Recipe[]} */ const picks = []
  while (picks.length < c.weeklyRecipes) {
    const left = list.filter((r) => !picks.includes(r))
    if (!left.length) break
    picks.push(pick(left, picks, c, rand))
  }
  return picks
}

/**
 * Swap picks[slot] for another eligible recipe, preferring ones not in the last KEEP plans.
 * @param {Recipe[]} rs candidates
 * @param {Config} c limits
 * @param {string[][]} history past plans excluding the current one, oldest first
 * @param {Recipe[]} picks current picks
 * @param {number} slot index to replace
 * @param {number} seed random seed
 * @returns {Recipe[] | null} the new picks, null when no other recipe is available
 */
export const reroll = (rs, c, history, picks, slot, seed) => {
  const keep = c.historyKeep ?? KEEP
  const used = new Set(history.slice(-keep).flat())
  const all = uniq(rs, c).filter((r) => !picks.some((p) => p.name === r.name))
  const fresh = all.filter((r) => !used.has(r.name))
  const list = fresh.length ? fresh : all
  if (!list.length) return null
  const next = pick(
    list,
    picks.filter((_, i) => i !== slot),
    c,
    rng(seed),
  )
  return picks.map((r, i) => (i === slot ? next : r))
}
