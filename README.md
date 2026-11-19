# mealrot

## Purpose

- Telegram meal-prep suggestions from a Cloudflare Worker: Sunday 16:00 UTC or `/plan`.
- Picks two one-pot recipes, six portions each, around 650 kcal per serving (10% tolerance), at least 35 g protein and a 45 g target.
- Reroll reuses the search pool; Save keeps recipes for future plans. Prefers recipes not in the last three plans, falling back when too few remain; varies protein, cuisine and base.

## Layout

```text
src/index.js       Telegram webhook, cron, buttons and KV state
src/planner.js     Limits, filtering, selection and reroll logic
src/spoon.js       Spoonacular recipe search
src/*.test.js      Node tests for webhook, search and planning
src/runtime.d.ts   Worker runtime types
wrangler.jsonc     Worker entrypoint, route, cron, KV and migrations
.github/workflows/ Node checks, hooks, review and dependency automation
package.json       Development, deployment and check commands
```

## Usage

From the repository root:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npx wrangler deploy --dry-run
npm run dev
```

- Put local secrets in gitignored `.dev.vars`: `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`, `WEBHOOK_SECRET`, `SPOONACULAR_API_KEY`. Never commit values.
- Telegram commands: `/plan`, `/reroll [n]`; inline buttons: Reroll and Save. Only the configured chat is accepted; the webhook validates its secret token.
- For another deployment, configure your own custom-domain route and `MEALROT_KV` binding in `wrangler.jsonc`; existing deployment identifiers are not reusable setup values.

## Operate

- Owner: `@lilfeelz` (`.github/CODEOWNERS`). MIT license: [LICENSE](LICENSE).
- CI: shared Node workflow runs typecheck, tests and lint; shared hooks run separately. No deployment job is declared in this repository.
- Deploy command: `npm run deploy` invokes Wrangler. Production deploys need owner approval; the currently configured external deployment trigger is unverified.
- Provision Worker secrets securely, then register Telegram's webhook for your deployed URL using the same `WEBHOOK_SECRET`. Exact credential/bootstrap procedure is unverified; do not place tokens in tracked files or command history.
- Rollback: a tested production version-rollback procedure is unverified. Keep a known-good commit and review compatibility before redeploying it through the approved deployment path.
- Recovery: KV stores `history`, `current` and `saved`; a code redeploy is not a data restore. KV backup/restore automation is unverified. Historical Durable Object creation/deletion migrations remain in `wrangler.jsonc`; do not remove them blindly.

## Dependencies

- Node/npm, Wrangler and a Cloudflare account with Workers, KV, cron and a custom domain.
- Telegram bot and chat, Spoonacular API key; development tools are pinned in `package-lock.json`.

## Status

- Implemented Worker; live deployment, webhook and recovery acceptance are unverified here. Target: preserve the existing meal-planning capability without adding infrastructure; no migration or publication change is selected.
