// What Autocart has learned about stock at the user's T&T store.
//
// Prices come from T&T's online catalogue (TinyFish Fetch can't choose a
// store), but the cart agent shops signed in at the user's own store. Its
// outcomes ("not at your store", "added") are recorded per postal area (FSA,
// e.g. "N6G") and used on the next price search to steer away from products
// that store doesn't carry. Store-level facts only; nothing personal.

export const STOCK_TTL_DAYS = 14;

/** Forward sortation area: the first 3 characters of a Canadian postal code. */
export function fsaOf(postalCode) {
  const m = String(postalCode ?? "").toUpperCase().match(/^([A-Z]\d[A-Z])/);
  return m ? m[1] : null;
}

/**
 * Turn cart-build outcomes into stock observations.
 * "added"/"updated" → available. "out_of_stock" → unavailable now.
 * "unavailable" (card not found) is weaker evidence because agents sometimes
 * miss a card, so the store only counts it after it happens twice (see db).
 */
export function observationsFrom(cartRun) {
  const out = [];
  for (const it of cartRun?.items ?? []) {
    if (!it.url) continue;
    if (it.outcome === "added" || it.outcome === "updated") out.push({ url: it.url, seen: "available" });
    else if (it.outcome === "out_of_stock") out.push({ url: it.url, seen: "out_of_stock" });
    // A substitute means the approved product wasn't there.
    else if (it.outcome === "unavailable" || it.outcome === "substituted") out.push({ url: it.url, seen: "not_found" });
  }
  return out;
}

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Apply known store stock to a research result.
 * @param {object} research   from researchList()
 * @param {Map<string, "available"|"unavailable">} known  by product URL
 * @param {string|null} fsa
 */
export function applyStoreStock(research, known, fsa) {
  const swaps = [];
  const stillMissing = [];
  const items = research.items.map((item) => {
    if (!item.chosen) return item;
    const tag = (p) => ({ ...p, storeStock: known.get(p.url) ?? null });
    const options = [item.chosen, ...(item.alternatives ?? [])].map(tag);
    if (options[0].storeStock !== "unavailable") {
      return { ...item, chosen: options[0], alternatives: options.slice(1) };
    }
    // Prefer an option seen in stock there, then one we know nothing about.
    const better =
      options.find((o) => o.storeStock === "available") ?? options.find((o) => o.storeStock !== "unavailable");
    if (!better) {
      stillMissing.push(item.name);
      const chosen = { ...options[0], flags: [...new Set([...(options[0].flags ?? []), "not-at-your-store"])] };
      return { ...item, status: "uncertain", chosen, alternatives: options.slice(1) };
    }
    swaps.push(`${item.name} (${options[0].name} → ${better.name})`);
    const chosen = { ...better, flags: [...new Set([...(better.flags ?? []), "store-swapped"])] };
    return { ...item, chosen, alternatives: options.filter((o) => o !== better) };
  });

  const store = { fsa, knownProducts: known.size, swapped: swaps.length, flagged: stillMissing.length };
  // Nothing learned applies: keep the research exactly as priced.
  if (!swaps.length && !stillMissing.length) return { ...research, items, store };

  const warnings = [...(research.warnings ?? [])];
  if (swaps.length) {
    warnings.push({ type: "store-stock", message: `Switched to products your ${fsa} store had last time: ${swaps.join("; ")}.` });
  }
  if (stillMissing.length) {
    warnings.push({ type: "store-stock", message: `Not stocked at your ${fsa} store last time: ${stillMissing.join(", ")}. Try "Search again" or remove them.` });
  }
  const total = round2(items.reduce((s, it) => s + (it.chosen?.cost ?? 0), 0));
  return {
    ...research,
    items,
    total,
    overBudget: total > research.budget,
    warnings,
    store,
  };
}
