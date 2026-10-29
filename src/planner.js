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
 * @property {number} kcal per portion, accepted within +-10%
 * @property {number} proteinMin g per portion
 * @property {number} proteinTarget g per portion
 * @property {number} weeklyRecipes recipes per plan
 */

/** @type {Config} */
export const LIMITS = { kcal: 650, proteinMin: 35, proteinTarget: 45, weeklyRecipes: 2 }

const TAGS = /** @type {const} */ (['protein', 'cuisine', 'base'])
const TOP = 3
export const KEEP = 3

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
 * @returns {Recipe[]} recipes with enough protein and kcal within 10% of the target
 */
export const eligible = (rs, c) =>
  rs.filter(
    (r) => r.macros.protein >= c.proteinMin && Math.abs(r.macros.kcal - c.kcal) <= c.kcal * 0.1,
  )

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
  const used = new Set(history.slice(-KEEP).flat())
  const all = eligible(rs, c).filter((r, i, a) => a.findIndex((x) => x.name === r.name) === i)
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
