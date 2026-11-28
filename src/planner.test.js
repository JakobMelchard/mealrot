import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LIMITS, config, eligible, plan, reroll, rng } from './planner.js'

/**
 * @param {string} name
 * @param {string} protein
 * @param {number} [kcal]
 * @param {number} [p]
 * @returns {import('./planner.js').Recipe}
 */
const r = (name, protein, kcal = 650, p = 45) => ({
  name,
  tags: { protein, cuisine: 'other', base: 'other' },
  macros: { kcal, protein: p, carbs: 50, fat: 20 },
  url: `https://x.test/${name}`,
})

const pool = [r('a', 'beef'), r('b', 'chicken'), r('c', 'fish'), r('d', 'tofu')]

test('picks weeklyRecipes distinct recipes', () => {
  const names = plan(pool, LIMITS, [], 1).map((x) => x.name)
  assert.equal(names.length, 2)
  assert.equal(new Set(names).size, 2)
})

test('skips recipes outside the limits', () => {
  const out = [r('lean', 'beef', 650, 20), r('big', 'beef', 900), r('ok', 'beef')]
  assert.deepEqual(
    plan(out, { ...LIMITS, weeklyRecipes: 3 }, [], 1).map((x) => x.name),
    ['ok'],
  )
})

test('leaves out the last three plans while enough others remain', () => {
  for (let seed = 0; seed < 20; seed++)
    assert.deepEqual(
      plan(pool, LIMITS, [['a'], ['b']], seed)
        .map((x) => x.name)
        .sort(),
      ['c', 'd'],
    )
})

test('repeats when too few fresh recipes remain', () => {
  assert.equal(plan(pool, LIMITS, [['a', 'b'], ['c']], 1).length, 2)
})

test('an old plan is forgotten after three', () => {
  const picked = new Set()
  for (let seed = 0; seed < 40; seed++)
    for (const x of plan(pool, LIMITS, [['a'], ['b'], ['b'], ['b']], seed)) picked.add(x.name)
  assert.ok(picked.has('a'))
})

test('no eligible recipe, no picks', () => {
  assert.deepEqual(plan([r('x', 'beef', 1000)], LIMITS, [], 1), [])
})

test('reroll swaps one slot for a recipe not already picked', () => {
  const picks = pool.slice(0, 2)
  for (let seed = 0; seed < 20; seed++) {
    const out = reroll(pool, LIMITS, [], picks, 0, seed)
    assert.equal(out?.[1], picks[1])
    assert.ok(out?.[0] && !picks.includes(out[0]))
  }
})

test('reroll prefers recipes outside the last plans', () => {
  for (let seed = 0; seed < 20; seed++)
    assert.equal(reroll(pool, LIMITS, [['c']], pool.slice(0, 2), 0, seed)?.[0]?.name, 'd')
})

test('reroll with no other recipe is null', () => {
  assert.equal(reroll(pool.slice(0, 2), LIMITS, [], pool.slice(0, 2), 0, 1), null)
})

test('rng is deterministic per seed and stays in [0, 1)', () => {
  const a = rng(42)
  const b = rng(42)
  const xs = Array.from({ length: 20 }, () => a())
  assert.deepEqual(xs, Array.from({ length: 20 }, () => b()))
  assert.ok(xs.every((x) => x >= 0 && x < 1))
})

test('eligible keeps only recipes within the protein and kcal limits', () => {
  const out = [
    r('low', 'beef', 650, 34),
    r('high', 'beef', 650, 35),
    r('light', 'beef', 585),
    r('heavy', 'beef', 715),
    r('too-light', 'beef', 584),
    r('too-heavy', 'beef', 716),
  ]
  assert.deepEqual(
    eligible(out, LIMITS).map((x) => x.name),
    ['high', 'light', 'heavy'],
  )
})

test('config parses valid overrides and falls back on blank or invalid values', () => {
  assert.deepEqual(config(undefined), LIMITS)
  assert.deepEqual(
    config({
      KCAL: '700',
      KCAL_TOLERANCE: 0.2,
      PROTEIN_MIN: '30',
      PROTEIN_TARGET: '50',
      WEEKLY_RECIPES: '3',
      PORTIONS: 4,
      HISTORY_KEEP: '5',
    }),
    {
      kcal: 700,
      kcalTolerance: 0.2,
      proteinMin: 30,
      proteinTarget: 50,
      weeklyRecipes: 3,
      portions: 4,
      historyKeep: 5,
    },
  )
  assert.deepEqual(
    config({
      KCAL: '0',
      KCAL_TOLERANCE: '1',
      PROTEIN_MIN: '-1',
      PROTEIN_TARGET: 'abc',
      WEEKLY_RECIPES: '1.5',
      PORTIONS: '',
      HISTORY_KEEP: 0,
    }),
    LIMITS,
  )
})

test('eligible and plan respect custom kcalTolerance and historyKeep', () => {
  const c = { ...LIMITS, kcalTolerance: 0.2, historyKeep: 1 }
  assert.deepEqual(
    eligible([r('a', 'beef', 780), r('b', 'beef', 781)], c).map((x) => x.name),
    ['a'],
  )
  for (let seed = 0; seed < 20; seed++) {
    const names = plan(pool, c, [['a', 'b'], ['c']], seed).map((x) => x.name)
    assert.ok(!names.includes('c'))
  }
})
