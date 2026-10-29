// Recipe research: fresh one-pot candidates from Spoonacular, mapped to the planner's Recipe.

/** @typedef {import('./planner.js').Recipe} Recipe */
/** @typedef {import('./planner.js').Config} Config */
/**
 * @typedef {object} Result complexSearch result with recipe information and nutrition
 * @property {number} id spoonacular recipe id
 * @property {string} title recipe name
 * @property {string[]} [cuisines] cuisines
 * @property {{name: string}[]} [extendedIngredients] ingredients
 * @property {{nutrients?: {name: string, amount: number}[]}} [nutrition] per serving
 * @property {string} [sourceUrl] original page
 */

// Rotated by seed so plans do not all search the same word.
const QUERIES = ['stew', 'chili', 'curry', 'one pot', 'soup', 'goulash', 'casserole', 'risotto']
const PROTEINS = [
  'chicken',
  'beef',
  'pork',
  'turkey',
  'lamb',
  'salmon',
  'cod',
  'tuna',
  'shrimp',
  'fish',
  'lentil',
  'chickpea',
  'bean',
  'tofu',
  'egg',
]
const BASES = [
  'rice',
  'pasta',
  'orzo',
  'noodle',
  'potato',
  'bulgur',
  'couscous',
  'quinoa',
  'barley',
  'bread',
]

/**
 * @param {string} text title and ingredient names
 * @param {string[]} words keywords in priority order
 * @returns {string} the first keyword in text, or 'other'
 */
const tag = (text, words) => words.find((w) => text.includes(w)) ?? 'other'

/**
 * The page a recipe links to. Recipes without an outside source point sourceUrl at a
 * spoonacular.com address that 404s; their own page is /recipes/<slug>-<id>.
 * @param {Result} r search result
 * @returns {string} recipe page
 */
const link = (r) =>
  r.sourceUrl && !/^https?:\/\/([^/]*\.)?spoonacular\.com\//.test(r.sourceUrl)
    ? r.sourceUrl
    : `https://spoonacular.com/recipes/${r.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}-${r.id}`

/**
 * @param {Result} r search result
 * @returns {Recipe | null} the recipe; null without nutrition
 */
export const toRecipe = (r) => {
  const n = Object.fromEntries((r.nutrition?.nutrients ?? []).map((x) => [x.name, x.amount]))
  if (n.Calories === undefined) return null
  const text = [r.title, ...(r.extendedIngredients ?? []).map((i) => i.name)]
    .join(' ')
    .toLowerCase()
  return {
    name: r.title,
    tags: {
      protein: tag(text, PROTEINS),
      cuisine: String(r.cuisines?.[0] ?? 'other').toLowerCase(),
      base: tag(text, BASES),
    },
    macros: {
      kcal: n.Calories,
      protein: n.Protein ?? 0,
      carbs: n.Carbohydrates ?? 0,
      fat: n.Fat ?? 0,
    },
    url: link(r),
  }
}

/**
 * Search main-course recipes inside the macro limits per serving. One search with
 * nutrition costs about 2 of the free plan's 50 daily points.
 * @param {string} key Spoonacular API key
 * @param {Config} c limits
 * @param {number} seed picks the query word
 * @returns {Promise<Recipe[]>} candidates, possibly empty
 */
export const search = async (key, c, seed) => {
  const q = new URLSearchParams({
    query: /** @type {string} */ (QUERIES[seed % QUERIES.length]),
    type: 'main course',
    minProtein: String(c.proteinMin),
    minCalories: String(Math.round(c.kcal * 0.9)),
    maxCalories: String(Math.round(c.kcal * 1.1)),
    addRecipeInformation: 'true',
    addRecipeNutrition: 'true',
    fillIngredients: 'true',
    instructionsRequired: 'true',
    sort: 'random',
    number: '10',
  })
  const r = await fetch(`https://api.spoonacular.com/recipes/complexSearch?${q}`, {
    headers: { 'x-api-key': key },
    signal: AbortSignal.timeout(20e3),
  })
  if (!r.ok) throw new Error(`spoonacular: ${r.status}`)
  const j = /** @type {{results?: Result[]}} */ (await r.json())
  return /** @type {Recipe[]} */ ((j.results ?? []).map(toRecipe).filter(Boolean))
}
