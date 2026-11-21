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
3. **Plan.** An LLM produces a structured meal plan and ingredient list. Server code (not the LLM) merges duplicates, removes pantry items and exclusions.
4. **Research.** TinyFish reads T&T search results for each ingredient: name, package size, price. Server code picks the best match by unit price, package size and exclusions, then totals the cart against the budget.
5. **Review.** You swap or remove items, see the total and any warnings (over budget, unavailable, allergy check).
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
| 3. Meal planner | ⏳ Next |
| 4. Product research | ⏳ |
| 5. Review, approve, build cart | ⏳ |
| 6. Polish and demo backup | ⏳ |

## Tech stack

- **Frontend:** React 19 + Vite, `@auth0/auth0-react`
- **Backend:** Node 24 + Express 5, `express-oauth2-jwt-bearer`
- **Database:** SQLite via Node's built-in `node:sqlite` (file at `data/cartpilot.db`)
- **Agent:** TinyFish (web fetch + browser automation)

## Project layout

```
src/
  main.jsx          Auth0Provider (requests a token for the CartPilot API)
  App.jsx           Login / logout shell
  ProfileForm.jsx   Load and save the grocery profile
  api.js            fetch wrapper that attaches the Auth0 access token
server/
  index.js          Reads env, opens the DB, starts the API
  app.js            Routes + Auth0 token and scope checks
  profile.js        Profile validation and defaults
  db.js             SQLite storage, keyed by Auth0 user id
  app.test.js       API tests (auth failures, scopes, per-user isolation, validation)
```

## API

All `/api/*` routes except health need `Authorization: Bearer <Auth0 access token>`.

| Method | Path | Scope | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | none | Liveness check |
| GET | `/api/profile` | `read:profile` | Your saved profile (defaults if none yet) |
| PUT | `/api/profile` | `write:profile` | Validate and save your profile |

Errors: `401` bad or missing token, `403` missing scope, `400` invalid input (with per-field messages).

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
