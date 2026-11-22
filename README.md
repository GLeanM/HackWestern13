# Autocart

**Your grocery cart, built for you.** (A play on Instacart.) HackWestern 2026, built for the Auth0 and TinyFish sponsor tracks.

You give Autocart a grocery budget, household size, food preferences, things to avoid, and what's already in your pantry. It turns that into a meal plan and shopping list, looks up real products and prices on **T&T Supermarket** (tntsupermarket.com), and uses a TinyFish browser agent to **add the approved items to your real T&T cart**. You review everything first, and you finish checkout yourself. Autocart never places orders or pays.

> Not affiliated with T&T Supermarket. Allergy filtering is a screening aid, not a guarantee: always check product labels yourself.

## The app

A web app with four steps in a sidebar (a pill bar on phones) and a live summary of the cart total against the budget:

1. **Profile**: budget, household, food preferences, pantry, postal code.
2. **Meal plan**: one click on **Plan & price my groceries** plans the meals and then prices the list at T&T automatically.
3. **Cart**: the shopping list appears straight away with "finding price…" placeholders, then turns into the editable cart (swap, pack counts, remove, search again).
4. **Build cart**: approve, then watch the TinyFish agents shop live (with a Stop button) and see what landed in the T&T cart.

The theme is white and green to match T&T. A dev-only design preview with sample data for every state is at `http://localhost:5173/src/dev/preview.html?state=priced` (states: landing, profile, planning, researching, priced, building, built).

> The Auth0 API identifier is still `https://cartpilot-api` from before the rename; changing it would mean re-creating the Auth0 API.

## How it works

```
Sign in (Auth0) → Save profile → Plan meals (LLM) → Look up products on T&T (TinyFish)
      → Review & edit in Autocart → Approve → Agent adds items to your T&T cart → You check out
```

1. **Sign in.** Auth0 handles sign-up and login. The React app gets an access token for the Autocart API.
2. **Profile.** Budget, people, days, diet, cuisines, allergies, foods to skip, nutrition and cooking preferences, postal code, and pantry. Saved per user.
3. **Plan.** Google Gemini (structured JSON output) produces a structured meal plan and ingredient list. Server code (not the LLM) merges duplicates, removes pantry items and exclusions.
4. **Research.** TinyFish Fetch reads T&T's search page for every item at once (about 30–40s for a full list). Server code parses the results, screens out allergens and "different foods" (quail eggs aren't eggs), picks the cheapest pack that covers the recipe quantity, retries simpler searches when nothing matches, and totals the cart against the budget.
5. **Review.** You swap to another product, change pack counts, remove or restore items, or search T&T again with your own words. The total updates instantly and is re-computed by the server (it never trusts prices from the browser). Warnings name the biggest lines when you're over budget.
6. **Approve & build cart.** Approving asks Auth0 for the `build:cart` permission at that moment (consent popup the first time). The server checks the permission and that the total and item count match what you approved, records the approval, then starts TinyFish browser agents signed in to T&T (stealth browser, two at a time, up to 5 items each). Each agent goes straight to T&T's search results page for an item and sets the matching product's cart quantity to exactly what you chose (for items sold by weight, a target in pounds). A live feed shows what each agent is doing, how long it has taken and how many steps (≈ cost) it has used. You can watch it live and **stop it** at any time (items already added stay in your cart). If T&T's website blocks an agent ("Access Denied"), it stops right away instead of burning time; blocked items, and items an agent ran out of time on or couldn't load, are retried once in a fresh session (one agent at a time after a block). Each item reports added / quantity set / out of stock / blocked / stopped, and the agent is told never to check out or pay; you finish on T&T.

### Sponsor integrations

| Sponsor | How Autocart uses it |
| --- | --- |
| **Auth0** | Login; access tokens checked on every API call (signature, issuer, audience, expiry); permission scopes per action (`read:profile`, `write:profile`, `build:cart`). `build:cart` is requested only when you approve (step-up consent) and the approval is recorded with your user id, total and time. All data keyed to the token's user id, never an id sent by the browser. Retailer credentials never reach the frontend or the LLM. |
| **TinyFish** | Fetch reads live T&T search results for product research. Web Agent runs with a saved, signed-in T&T Browser Context Profile build the real cart, with live browser views embedded in the app. |

## Status

| Phase | State |
| --- | --- |
| 1. Prove the agent on a real retailer | ✅ T&T search reading and add-to-cart verified (Walmart.ca was dropped: its bot check blocked cart actions) |
| 2. Secure shell: Express API, Auth0 tokens, saved profiles | ✅ Done, tested with a real login |
| 3. Meal planner (Gemini → consolidated shopping list) | ✅ Done |
| 4. Product research and pricing on T&T (TinyFish Fetch) | ✅ Done |
| 5. Review screen: swap, pack counts, remove/restore, search again | ✅ Done |
| 6. Approve & build the T&T cart (TinyFish agent, `build:cart` step-up) | ✅ Done |
| 7. Polish and demo backup | ⏳ Next |

## Tech stack

- **Frontend:** React 19 + Vite, `@auth0/auth0-react`
- **Backend:** Node 24 + Express 5, `express-oauth2-jwt-bearer`
- **Database:** SQLite via Node's built-in `node:sqlite` (file at `data/cartpilot.db`)
- **Meal planning:** Google Gemini (`gemini-3.5-flash`, low thinking; falls back to `gemini-flash-latest`)
- **Agent:** TinyFish (web fetch + browser automation)

## Project layout

```
src/
  main.jsx          Auth0Provider (requests a token for the Autocart API)
  App.jsx           App shell + step router (signed-in) / landing page (signed-out)
  AppShell.jsx      Top bar, step navigation, cart summary rail
  Landing.jsx       Signed-out landing page
  ui.jsx            Shared UI kit: buttons, cards, chips, skeletons, icons, budget meter
  useTask.js        Loads and polls the current shopping task
  steps/            MealPlanStep, CartStep, BuildStep
  dev/              Design preview with sample data (dev only)
  ProfileForm.jsx   Load and save the grocery profile
  ReviewCart.jsx    Review screen: products, pack stepper, swap options, remove/restore, search again, live total vs budget
  ApproveCart.jsx   Approve & build: confirmation, build:cart step-up, sends the approved total
  CartBuild.jsx     Live TinyFish browser views, per-item outcomes, link to the T&T cart
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
  cart/
    agent.js        TinyFish Web Agent client: start an async run, poll status / live view / result
    buildCart.js    Runs the agent one batch at a time: goal (search like a shopper, exact quantities, stop on a block, never check out), retry of blocked items, cancel, outcomes
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
| POST | `/api/shopping-tasks` | `read:profile` | Start a meal plan from your saved profile (+ optional `note`). Returns `202` with a task in `planning` state; when the plan is ready, T&T pricing starts automatically (`researching` → `priced`) |
| GET | `/api/shopping-tasks` | `read:profile` | Your 10 most recent tasks |
| GET | `/api/shopping-tasks/:id` | `read:profile` | One of your tasks: meals, shopping list, pantry-covered items, removed items, warnings, and T&T prices once found. Other users' tasks are `404` |
| POST | `/api/shopping-tasks/:id/research` | `read:profile` | Look up every list item on T&T and price it (read-only; nothing is added to a cart). Returns `202` with status `researching`, then `priced`. Re-pricing keeps review choices where possible |
| PATCH | `/api/shopping-tasks/:id/cart` | `read:profile` | Review edits `{ edits: [{ index, name, option?, packages?, removed? }] }`. Prices are recomputed on the server from stored research; any price sent by the client is rejected |
| POST | `/api/shopping-tasks/:id/items/:index/search` | `read:profile` | Search T&T again for one item with your own words `{ query }` (waits ~25–40s). Not found keeps the previous pick |
| POST | `/api/shopping-tasks/:id/build-cart/cancel` | `read:profile` | Stop the running agent (cancels its TinyFish run). Items already added stay in the T&T cart |
| POST | `/api/shopping-tasks/:id/build-cart` | **`build:cart`** | Approve the reviewed cart `{ expectedTotal, expectedItems }` (must match the server's review, else `409 stale_review`). Returns `202` with status `building`; poll the task for live agent views and per-item outcomes, then `built` |

Errors: `401` bad or missing token, `403` missing scope, `400` invalid input (with per-field messages), `409` no saved profile yet, wrong task state, or something already running, `502` T&T couldn't be reached.

## Running locally

Requires Node 24+.

1. **Auth0 setup** (once):
   - A **Single Page Application** with callback, logout and web-origin URLs set to `http://localhost:5173`.
   - An **API** with identifier `https://cartpilot-api` (RS256) and permissions `read:profile`, `write:profile`, `build:cart`.
   - On the API's **Application Access** tab, under **User Access**, set the SPA to **Authorized** (including `build:cart`).
1. **TinyFish setup** (once): create a Browser Context Profile, sign in to tntsupermarket.com in its setup browser and pick your postal code, then put its id in `TINYFISH_PROFILE_ID`. For the demo this is one team T&T account; per-user T&T connections are future work.
2. Copy `.env.example` to `.env.local` and fill in your values.
3. Install and run:

   ```sh
   npm install
   npm run dev     # web on http://localhost:5173, API on http://localhost:3001 (proxied at /api)
   npm test        # backend tests
   ```

## Lessons from live testing

- T&T's website answers "Access Denied" to automated **direct product-page links** and to **two agents on one account at once**, while its search pages keep working. The agent therefore uses TinyFish's stealth browser, starts at the home page, adds items from search results, and runs one at a time. On the same items this went from ~27 minutes / 222 steps with mostly failures to ~3 minutes / 19 steps with everything added.
- Going straight to `search.html?query=…` instead of typing in the search box cut each item from 4–9 agent steps to 2–3 (the box only shows a suggestion dropdown first). The best runs add an item in ~30s.
- What's left of the time is outside Autocart: ~35s for TinyFish to start each browser, 8–35s per agent step depending on the session, slow-loading T&T pages, and a subscription popup. Two agents at once hide a slow session behind a fast one; T&T didn't block this with search pages.
- T&T's cart counts weight items in pounds, so the agent gets a pound target (e.g. "about 2 lb") and never reduces an existing amount; it used to cut 2 lb of pork to "1".
- Prices come from T&T's online catalogue (default store), but the signed-in store may not stock every item ("Not at your store"). Autocart now **learns each store's stock from the cart agent**: what it adds or finds out of stock is recorded per postal area (FSA, e.g. N6G). On the next price search, products that store didn't have are swapped for an option it did have, or flagged on the review screen before you approve. A single "couldn't find it" needs to happen twice before it counts, because agents occasionally miss a card.
- **Why not price the user's store directly?** We tested it. T&T keeps the shopper's postal code and store code in browser storage (`x-postcode`, `x-prefered-store-code`) and sends both with every product search. A TinyFish remote browser can set the postal code, but T&T only maps a postal code to a store inside its pickup dialog, which needs a Google Map that doesn't load in the remote browser. Magento's standard `pickupLocations` query is disabled, and the saved TinyFish profile doesn't keep the store choice. With the right store code this would work; finding it automatically is future work.
- A blocked agent used to keep trying for 100+ steps; it now stops at the first block and reports it as **blocked** (not "out of stock").
- If the server restarts mid-build, leftover TinyFish runs are cancelled on startup so they don't keep costing money.

### Measured cart-build times (live, T&T account)

| Version | Items | Wall time | Agent steps | Outcome |
| --- | --- | --- | --- | --- |
| Product-page links, 2 agents (original) | 9 | ~20 min | 222 | Mostly "Access Denied" |
| Home page + search box, 1 agent (PR #6) | 5 | 7.5 min (hit time cap) | 41 | 4 added, 1 falsely "unavailable" |
| Search-results URL, 1 agent | 6 | 6.6 min | 25 | All handled; 2 not stocked at the store |
| Search-results URL, 2 agents + retry | 4 | 5.6 min | 20 | All added, pound targets correct |

### Future speed-ups
- Add items through T&T's own cart API from inside a TinyFish browser session (seconds instead of minutes), at the cost of bypassing the browsing agent and handling the user's T&T session token.
- Start the next agent's browser early to hide the ~35s start-up.
- Price items from the user's own T&T store directly (needs T&T's postal-code-to-store mapping; see above).

## Safety principles

- The user reviews and approves the cart before the agent touches it; checkout and payment are always manual.
- Prices are estimates from the time they were retrieved and can change; stock depends on store/postal code.
- Secrets live only in `.env.local` (gitignored) and on the server.
