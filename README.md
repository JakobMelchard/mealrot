# mealrot

Meal-prep suggestions in one Telegram chat. Every Sunday 16:00 UTC, and on `/plan`, the Worker researches one-pot main courses on Spoonacular (inside the kcal and protein limits per serving), picks 2 and sends one message per meal with its link, so Telegram previews it. Each recipe is a batch of 6 portions. Each meal has buttons: Reroll swaps it for another recipe from the same search (no new search; `/reroll [n]` does the same), Save keeps it for later plans. Plans from the last 3 sends are not repeated (KV: `history`, `current`, `saved`); protein, cuisine and base are varied.

| Path                   | Contents                                                |
| ---------------------- | ------------------------------------------------------- |
| `functions/index.js`   | Webhook (`/plan`, `/reroll`, buttons), cron, KV state   |
| `functions/spoon.js`   | Spoonacular `complexSearch`, about 2 of 50 daily points |
| `functions/planner.js` | Limits, filter and pick                                 |

```sh
make validate    # from the repo root; tests, tsc, eslint, wrangler dry run
```

Limits are `LIMITS` in `planner.js`: 650 kcal (+-10%), 35 g protein minimum, 45 g target, 2 recipes.

## Secrets

Infisical `cloudflare` `/workers/mealrot`: `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`, `WEBHOOK_SECRET` (any random string), `SPOONACULAR_API_KEY`.

## Webhook

Once after the first deploy, and again if `WEBHOOK_SECRET` changes. Only the chat in `TELEGRAM_CHAT_ID` is answered; anything else is ignored.

```sh
curl -sS "https://api.telegram.org/bot$TELEGRAM_TOKEN/setWebhook" \
  -d url=https://mealrot.melchard.org/ -d secret_token="$WEBHOOK_SECRET" \
  -d 'allowed_updates=["message","callback_query"]'
```
