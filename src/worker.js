/** @typedef {Record<string, unknown>} Env */

export default {
  /**
   * @param {Request} req incoming request
   * @param {Env} _env bindings from wrangler.jsonc
   * @returns {Promise<Response>} the answer
   */
  async fetch(req, _env) {
    const url = new URL(req.url)
    if (url.pathname === '/') return new Response('mealrot\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } })
    return new Response('not found\n', { status: 404 })
  },
}
