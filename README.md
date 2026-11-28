# mealrot

Telegram meal-prep suggestions from a Cloudflare Worker. Every Sunday at 16:00 UTC, or on
`/plan`, it picks two one-pot recipes of six portions each.

```text
Telegram ──▶ Worker (webhook, cron) ──▶ planner ──▶ Spoonacular search
                  │                        │
                  └──▶ Workers KV ◀────────┘
                       history, current, saved
```

## Quickstart

```sh
npm ci
npm run typecheck
npm run lint
npm test
npx wrangler deploy --dry-run
npm run dev
```

Put local secrets in the gitignored `.dev.vars`: `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`,
`WEBHOOK_SECRET` and `SPOONACULAR_API_KEY`. Never commit values.

## Commands

| Input | Effect |
|---|---|
| `/plan` | new plan of two recipes |
| `/reroll [n]` | replace plan `n` from the same search pool |
| Reroll, Save | inline buttons on the plan message |

Only the configured chat is accepted; the webhook validates its secret token.

## Behaviour

- Two one-pot recipes, six portions each, around 650 kcal per serving (10% tolerance).
- At least 35 g protein per serving, 45 g target.
- Prefers recipes that are not in the last three plans, falling back when too few remain.
- Varies protein, cuisine and base across the pair.
- Defaults are overridden through `wrangler.jsonc` `vars` or Worker environment variables.

## Configuration

| Variable | Default | Rule |
|---|---|---|
| `KCAL` | `650` | `> 0` |
| `KCAL_TOLERANCE` | `0.1` | `[0, 1)` |
| `PROTEIN_MIN` | `35` | `>= 0` |
| `PROTEIN_TARGET` | `45` | `>= 0` |
| `WEEKLY_RECIPES` | `2` | positive integer |
| `PORTIONS` | `6` | positive integer |
| `HISTORY_KEEP` | `3` | positive integer |

## Layout

```text
src/index.js       Telegram webhook, cron, buttons and KV state
src/planner.js     limits, filtering, selection and reroll logic
src/spoon.js       Spoonacular recipe search
src/*.test.js      Node tests for webhook, search and planning
wrangler.jsonc     Worker entrypoint, route, cron, KV and migrations
```

For another deployment, configure your own custom-domain route and `MEALROT_KV` binding
in `wrangler.jsonc`.

## Development

```sh
npm test
npm run dev
```

Dependencies: Node and npm, Wrangler, a Cloudflare account with Workers, KV, cron and a
custom domain, a Telegram bot and chat, and a Spoonacular API key. Dev tools are pinned
in `package-lock.json`.

## License

MIT, see [LICENSE](LICENSE).
