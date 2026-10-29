import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LIMITS, plan, reroll } from './planner.js'

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
