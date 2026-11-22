# CartPilot

**Your personal AI grocery-shopping employee.** HackWestern 2026, built for the Auth0 and TinyFish sponsor tracks.

You give CartPilot a grocery budget, household size, food preferences, things to avoid, and what's already in your pantry. It turns that into a meal plan and shopping list, looks up real products and prices on **T&T Supermarket** (tntsupermarket.com), and uses a TinyFish browser agent to **add the approved items to your real T&T cart**. You review everything first, and you finish checkout yourself. CartPilot never places orders or pays.

> Not affiliated with T&T Supermarket. Allergy filtering is a screening aid, not a guarantee: always check product labels yourself.

## How it works

```
Sign in (Auth0) → Save profile → Plan meals (LLM) → Look up products on T&T (TinyFish)
      → Review & edit in CartPilot → Approve → Agent adds items to your T&T cart → You check out
```

1. **Sign in.** Auth0 handles sign-up and login. The React app gets an access token for the CartPilot API.
2. **Profile.** Budget, people, days, diet, cuisines, allergies, foods to skip, nutrition and cooking preferences, postal code, and pantry. Saved per user.
3. **Plan.** Google Gemini (structured JSON output) produces a structured meal plan and ingredient list. Server code (not the LLM) merges duplicates, removes pantry items and exclusions.
4. **Research.** TinyFish Fetch reads T&T's search page for every item at once (about 30–40s for a full list). Server code parses the results, screens out allergens and "different foods" (quail eggs aren't eggs), picks the cheapest pack that covers the recipe quantity, retries simpler searches when nothing matches, and totals the cart against the budget.
5. **Review.** You swap to another product, change pack counts, remove or restore items, or search T&T again with your own words. The total updates instantly and is re-computed by the server (it never trusts prices from the browser). Warnings name the biggest lines when you're over budget.
6. **Build cart.** After you approve, a TinyFish agent signed in to your T&T account adds exactly those products to the cart. It is explicitly told never to check out or pay.

### Sponsor integrations

| Sponsor | How CartPilot uses it |
| --- | --- |
| **Auth0** | Login; access tokens checked on every API call (signature, issuer, audience, expiry); permission scopes per action (`read:profile`, `write:profile`, `build:cart`); all data keyed to the token's user id, never an id sent by the browser. Retailer credentials never reach the frontend or the LLM. |
| **TinyFish** | Reads live T&T search results for product research, and runs a browser agent with a saved, signed-in T&T session to build the real cart. |

## Status

| Phase | State |
| --- | --- |
| 1. Prove the agent on a real retailer | ✅ T&T search reading and add-to-cart verified (Walmart.ca was dropped: its bot check blocked cart actions) |
| 2. Secure shell: Express API, Auth0 tokens, saved profiles | ✅ Done, tested with a real login |
| 3. Meal planner (Gemini → consolidated shopping list) | ✅ Done |
| 4. Product research and pricing on T&T (TinyFish Fetch) | ✅ Done |
| 5. Review screen: swap, pack counts, remove/restore, search again | ✅ Done |
| 6. Approve & build the T&T cart (TinyFish agent, `build:cart`) | ⏳ Next |
| 7. Polish and demo backup | ⏳ |

## Tech stack

- **Frontend:** React 19 + Vite, `@auth0/auth0-react`
- **Backend:** Node 24 + Express 5, `express-oauth2-jwt-bearer`
- **Database:** SQLite via Node's built-in `node:sqlite` (file at `data/cartpilot.db`)
- **Meal planning:** Google Gemini (`gemini-3.5-flash`, low thinking; falls back to `gemini-flash-latest`)
- **Agent:** TinyFish (web fetch + browser automation)

## Project layout

```
src/
  main.jsx          Auth0Provider (requests a token for the CartPilot API)
  App.jsx           Login / logout shell
  ProfileForm.jsx   Load and save the grocery profile
  PlanPanel.jsx     Start a plan, poll it, show meals and the shopping list
  ReviewCart.jsx    Review screen: products, pack stepper, swap options, remove/restore, search again, live total vs budget
  api.js            fetch wrapper that attaches the Auth0 access token
server/
  index.js          Reads env, opens the DB, starts the API
  app.js            Routes + Auth0 token and scope checks
  profile.js        Profile validation and defaults
  db.js             SQLite storage (profiles, shopping tasks), keyed by Auth0 user id
  tasks.js          Starts a planning task and runs it in the background
  planner/
    gemini.js       Gemini REST client: structured JSON, retries, model fallback
    mealPlan.js     Prompt + JSON schema for the meal plan
    consolidate.js  Merges ingredients, removes pantry/allergy/avoid/diet items, warnings
  research/
    tinyfish.js     TinyFish Fetch client: batches of 10 URLs, retries failed URLs
    tntParser.js    Parses T&T search results (prices, sales, per-lb, sizes, deals, links)
    match.js        Picks the right product: relevance, allergy/diet screening, cheapest pack that covers the need
    research.js     Prices the whole list, retries simpler searches, totals vs budget
    fixtures/       Real T&T search results used by the tests
  review/
    cart.js         Review-cart rules shared with the browser: selections, edit validation, totals, warnings, carry-over
  app.test.js       API tests (auth, scopes, isolation, validation, tasks, pricing, review)
```

## API

All `/api/*` routes except health need `Authorization: Bearer <Auth0 access token>`.

| Method | Path | Scope | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | none | Liveness check |
| GET | `/api/profile` | `read:profile` | Your saved profile (defaults if none yet) |
| PUT | `/api/profile` | `write:profile` | Validate and save your profile |
| POST | `/api/shopping-tasks` | `read:profile` | Start a meal plan from your saved profile (+ optional `note`). Returns `202` with a task in `planning` state |
| GET | `/api/shopping-tasks` | `read:profile` | Your 10 most recent tasks |
| GET | `/api/shopping-tasks/:id` | `read:profile` | One of your tasks: meals, shopping list, pantry-covered items, removed items, warnings, and T&T prices once found. Other users' tasks are `404` |
| POST | `/api/shopping-tasks/:id/research` | `read:profile` | Look up every list item on T&T and price it (read-only; nothing is added to a cart). Returns `202` with status `researching`, then `priced`. Re-pricing keeps review choices where possible |
| PATCH | `/api/shopping-tasks/:id/cart` | `read:profile` | Review edits `{ edits: [{ index, name, option?, packages?, removed? }] }`. Prices are recomputed on the server from stored research; any price sent by the client is rejected |
| POST | `/api/shopping-tasks/:id/items/:index/search` | `read:profile` | Search T&T again for one item with your own words `{ query }` (waits ~25–40s). Not found keeps the previous pick |

Errors: `401` bad or missing token, `403` missing scope, `400` invalid input (with per-field messages), `409` no saved profile yet, wrong task state, or something already running, `502` T&T couldn't be reached.

## Running locally

Requires Node 24+.

1. **Auth0 setup** (once):
   - A **Single Page Application** with callback, logout and web-origin URLs set to `http://localhost:5173`.
   - An **API** with identifier `https://cartpilot-api` (RS256) and permissions `read:profile`, `write:profile`, `build:cart`.
   - On the API's **Application Access** tab, under **User Access**, set the SPA to **Authorized**.
2. Copy `.env.example` to `.env.local` and fill in your values.
3. Install and run:

   ```sh
   npm install
   npm run dev     # web on http://localhost:5173, API on http://localhost:3001 (proxied at /api)
   npm test        # backend tests
   ```

## Safety principles

- The user reviews and approves the cart before the agent touches it; checkout and payment are always manual.
- Prices are estimates from the time they were retrieved and can change; stock depends on store/postal code.
- Secrets live only in `.env.local` (gitignored) and on the server.
