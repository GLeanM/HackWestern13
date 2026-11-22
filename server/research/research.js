// Prices a shopping list on T&T: search each item via TinyFish Fetch, parse
// the results, pick a product, and retry simpler queries for items with no
// relevant match ("boneless chicken thighs" → "chicken thighs").

import { normalize } from "../planner/consolidate.js";
import { parseSearch, searchUrl } from "./tntParser.js";
import { pickProduct } from "./match.js";

const round2 = (x) => Math.round(x * 100) / 100;

/** Simpler queries to try when the first one finds nothing relevant. */
export function fallbackQueries(term) {
  const w = term.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 1; i <= w.length - 2; i++) out.push(w.slice(i).join(" ")); // drop leading adjectives
  if (w.length > 1) out.push(normalize(w.at(-1))); // singular head noun
  return [...new Set(out)].filter((q) => q && q !== term.toLowerCase()).slice(0, 2);
}

/**
 * @param {object[]} toBuy   from consolidate()
 * @param {object} profile
 * @param {{fetchPages: (urls: string[]) => Promise<Map>}} deps
 */
export async function researchList(toBuy, profile, { fetchPages, now = () => new Date() }) {
  const results = new Array(toBuy.length).fill(null);
  let pending = toBuy.map((item, i) => ({ i, item, queries: [item.searchTerm || item.name, ...fallbackQueries(item.searchTerm || item.name)] }));
  let fetchErrors = 0;

  for (let round = 0; round < 3 && pending.length; round++) {
    const work = pending.filter((p) => p.queries[round]);
    if (!work.length) break;
    const pages = await fetchPages(work.map((p) => searchUrl(p.queries[round])));
    const next = [];
    for (const p of work) {
      const query = p.queries[round];
      const page = pages.get(searchUrl(query));
      if (!page?.ok) {
        fetchErrors++;
        results[p.i] ??= { status: "not_found", query, chosen: null, alternatives: [], excluded: [], error: page?.error ?? "fetch_failed" };
        next.push(p);
        continue;
      }
      const picked = pickProduct(p.item, parseSearch(page).products, profile, query, { fallback: round > 0 });
      // Keep the best outcome so far; only retry when nothing relevant was found.
      if (picked.status !== "not_found" || !results[p.i] || results[p.i].error) results[p.i] = picked;
      if (picked.status === "not_found") next.push(p);
    }
    pending = next;
  }

  const items = toBuy.map((item, i) => ({
    name: item.name,
    category: item.category,
    quantities: item.quantities,
    ...results[i],
  }));
  const found = items.filter((it) => it.chosen);
  const total = round2(found.reduce((s, it) => s + it.chosen.cost, 0));
  const notFound = items.filter((it) => !it.chosen);
  const uncertain = items.filter((it) => it.status === "uncertain");

  const warnings = [];
  if (total > profile.budget) {
    warnings.push({ type: "budget", message: `Estimated total $${total.toFixed(2)} is $${(total - profile.budget).toFixed(2)} over your $${profile.budget} budget. Remove items or choose cheaper options.` });
  }
  if (notFound.length) {
    warnings.push({ type: "not-found", message: `Couldn't find a match on T&T for: ${notFound.map((i) => i.name).join(", ")}.` });
  }
  if (uncertain.length) {
    warnings.push({ type: "uncertain", message: `Check these picks before building the cart: ${uncertain.map((i) => i.name).join(", ")}.` });
  }
  if (fetchErrors && notFound.some((i) => i.error)) {
    warnings.push({ type: "fetch", message: "Some T&T searches failed to load. Try pricing again in a moment." });
  }
  if (profile.allergies.length) {
    warnings.push({ type: "allergy-check", message: "Products were screened by name only. Always check ingredient labels for allergens." });
  }

  return {
    items,
    total,
    budget: profile.budget,
    overBudget: total > profile.budget,
    counts: { matched: items.length - notFound.length - uncertain.length, uncertain: uncertain.length, notFound: notFound.length },
    retrievedAt: now().toISOString(),
    storeNote: "Prices and stock from T&T's online store (default location). Your store may differ; availability is re-checked when the cart is built.",
    warnings,
  };
}
