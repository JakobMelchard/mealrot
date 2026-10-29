import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LIMITS } from './planner.js'
import { search, toRecipe } from './spoon.js'

const res = {
  id: 7,
  title: 'Beef Chili',
  cuisines: ['Mexican'],
  extendedIngredients: [{ name: 'ground beef' }, { name: 'Rice' }],
  nutrition: {
    nutrients: [
      { name: 'Calories', amount: 640 },
      { name: 'Protein', amount: 41 },
      { name: 'Carbohydrates', amount: 60 },
      { name: 'Fat', amount: 18 },
    ],
  },
  sourceUrl: 'https://blog.test/chili',
}

test('toRecipe maps macros, tags and the source link', () => {
  assert.deepEqual(toRecipe(res), {
    name: 'Beef Chili',
    tags: { protein: 'beef', cuisine: 'mexican', base: 'rice' },
    macros: { kcal: 640, protein: 41, carbs: 60, fat: 18 },
    url: 'https://blog.test/chili',
  })
})

test('toRecipe links the Spoonacular page when the source is Spoonacular', () => {
  const s = { ...res, sourceUrl: 'https://spoonacular.com/beef-chili-7' }
  assert.equal(toRecipe(s)?.url, 'https://spoonacular.com/recipes/beef-chili-7')
})

test('toRecipe drops results without nutrition', () => {
  assert.equal(toRecipe({ ...res, nutrition: undefined }), null)
})

test('search sends the limits and key, and maps results', async () => {
  const orig = globalThis.fetch
  /** @type {{url: string, key: string | null}[]} */
  const calls = []
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (url, init) => {
      calls.push({ url: String(url), key: new Headers(init?.headers).get('x-api-key') })
      return Response.json({ results: [res, { ...res, nutrition: undefined }] })
    }
  )
  try {
    const rs = await search('k', LIMITS, 1)
    assert.equal(rs.length, 1)
    assert.equal(calls[0]?.key, 'k')
    const q = new URL(calls[0]?.url ?? '').searchParams
    assert.equal(q.get('minProtein'), '35')
    assert.equal(q.get('maxCalories'), '715')
  } finally {
    globalThis.fetch = orig
  }
})

test('search throws on an API error', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = /** @type {typeof fetch} */ (async () => new Response('', { status: 402 }))
  try {
    await assert.rejects(search('k', LIMITS, 0), /spoonacular: 402/)
  } finally {
    globalThis.fetch = orig
  }
})
