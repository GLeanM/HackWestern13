// Review-cart logic shared by the server (authoritative) and the browser
// (instant feedback). Pure JavaScript, no Node or DOM imports.
//
// A selection per research item: { option, packages, removed }
//   option   index into [item.chosen, ...item.alternatives]
//   packages how many packs to buy (1–20)
//   removed  the user dropped this item
// Prices always come from the stored research, never from the client.

export const MAX_PACKAGES = 20;
const round2 = (x) => Math.round(x * 100) / 100;

export const optionsOf = (item) => (item?.chosen ? [item.chosen, ...(item.alternatives ?? [])] : []);

export function defaultSelection(item) {
  return { option: 0, packages: item?.chosen?.packages ?? 1, removed: false };
}

export function defaultSelections(research) {
  return research.items.map(defaultSelection);
}

/**
 * Validate and apply edits. Returns { selections } or { errors: [{ index, field, message }] }.
 * Edit shape: { index, name, option?, packages?, removed? }
 */
export function applyEdits(research, selections, edits) {
  const errors = [];
  if (!Array.isArray(edits) || edits.length === 0 || edits.length > 50) {
    return { errors: [{ field: "edits", message: "must be a list of 1–50 edits" }] };
  }
  const next = selections.map((s) => ({ ...s }));
  const allowed = new Set(["index", "name", "option", "packages", "removed"]);

  for (const edit of edits) {
    if (!edit || typeof edit !== "object" || Array.isArray(edit)) {
      errors.push({ field: "edit", message: "must be an object" });
      continue;
    }
    const { index } = edit;
    const err = (field, message) => errors.push({ index, field, message });
    for (const key of Object.keys(edit)) if (!allowed.has(key)) err(key, "unknown field");
    const item = Number.isInteger(index) ? research.items[index] : undefined;
    if (!item) {
      err("index", "no such item");
      continue;
    }
    if (edit.name !== item.name) {
      err("name", "doesn't match this item (the list may have changed; reload)");
      continue;
    }
    const sel = next[index];
    const opts = optionsOf(item);

    if (edit.option !== undefined) {
      if (!Number.isInteger(edit.option) || edit.option < 0 || edit.option >= opts.length) {
        err("option", `must be between 0 and ${Math.max(opts.length - 1, 0)}`);
      } else if (edit.option !== sel.option) {
        sel.option = edit.option;
        // A different product has a different pack size; start from its suggested count.
        if (edit.packages === undefined) sel.packages = opts[edit.option].packages ?? 1;
      }
    }
    if (edit.packages !== undefined) {
      if (!Number.isInteger(edit.packages) || edit.packages < 1 || edit.packages > MAX_PACKAGES) {
        err("packages", `must be a whole number from 1 to ${MAX_PACKAGES}`);
      } else {
        sel.packages = edit.packages;
      }
    }
    if (edit.removed !== undefined) {
      if (typeof edit.removed !== "boolean") err("removed", "must be true or false");
      else if (!edit.removed && !opts.length) err("removed", "this item wasn't found on T&T, so it can't be added");
      else sel.removed = edit.removed;
    }
  }
  return errors.length ? { errors } : { selections: next };
}

/** Lines, totals, and warnings for the current selections. */
export function summarize(research, selections, budget) {
  const lines = research.items.map((item, index) => {
    const sel = selections[index] ?? defaultSelection(item);
    const opts = optionsOf(item);
    const product = opts[sel.option] ?? opts[0] ?? null;
    const missing = !product;
    const removed = !missing && sel.removed;
    const cost = missing || removed ? 0 : round2(product.packPrice * sel.packages);
    return {
      index,
      name: item.name,
      status: item.status,
      query: item.query,
      product,
      option: sel.option,
      optionCount: opts.length,
      packages: sel.packages,
      cost,
      removed,
      missing,
      flags: product?.flags ?? [],
    };
  });

  const active = lines.filter((l) => !l.removed && !l.missing);
  const total = round2(active.reduce((s, l) => s + l.cost, 0));
  const warnings = [];

  if (total > budget) {
    const biggest = [...active].sort((a, b) => b.cost - a.cost).slice(0, 3);
    warnings.push({
      type: "budget",
      message: `$${(total - budget).toFixed(2)} over your $${budget} budget. Biggest lines: ${biggest
        .map((l) => `${l.name} ($${l.cost.toFixed(2)})`)
        .join(", ")}.`,
    });
  }
  const noLink = active.filter((l) => !l.product.url);
  if (noLink.length) {
    warnings.push({ type: "no-link", message: `The agent can't add ${noLink.map((l) => l.name).join(", ")} (no product link). Swap or remove ${noLink.length > 1 ? "them" : "it"}.` });
  }
  const check = active.filter((l) => l.option === 0 && l.status === "uncertain");
  if (check.length) {
    warnings.push({ type: "uncertain", message: `Double-check: ${check.map((l) => l.name).join(", ")}.` });
  }
  const missing = lines.filter((l) => l.missing);
  if (missing.length) {
    warnings.push({ type: "not-found", message: `Not found on T&T: ${missing.map((l) => l.name).join(", ")}. Try "Search again" with other words.` });
  }

  return {
    lines,
    total,
    budget,
    remaining: round2(budget - total),
    overBudget: total > budget,
    itemCount: active.length,
    readyForAgent: active.filter((l) => l.product.url).length,
    warnings,
  };
}

/**
 * After the whole list is re-priced, keep what the user decided where it
 * still applies: removals, and the same product (by URL) with its pack count.
 */
export function carryOver(oldResearch, oldSelections, newResearch) {
  const byName = new Map(
    (oldResearch?.items ?? []).map((item, i) => [item.name, { item, sel: oldSelections?.[i] }]),
  );
  return newResearch.items.map((item) => {
    const fresh = defaultSelection(item);
    const prev = byName.get(item.name);
    if (!prev?.sel) return fresh;
    const prevProduct = optionsOf(prev.item)[prev.sel.option];
    const opts = optionsOf(item);
    const same = prevProduct?.url ? opts.findIndex((o) => o.url === prevProduct.url) : -1;
    return {
      option: same >= 0 ? same : 0,
      packages: same >= 0 ? prev.sel.packages : fresh.packages,
      removed: Boolean(prev.sel.removed) && opts.length > 0,
    };
  });
}
