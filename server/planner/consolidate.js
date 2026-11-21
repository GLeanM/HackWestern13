// Deterministic shopping-list logic. Takes the LLM's per-meal ingredients and
// the user's profile; returns the list to buy, what the pantry covers, and
// warnings. No LLM involvement, so the numbers are predictable and testable.

import { MAX_ITEMS } from "./mealPlan.js";

// Whole (singularised) words, so "eggplant" is not "egg".
const SEAFOOD = ["fish", "salmon", "tuna", "shrimp", "prawn", "cod", "tilapia", "crab", "squid", "anchovy", "mackerel", "scallop", "mussel", "clam"];
const MEAT_FISH = ["chicken", "beef", "pork", "lamb", "turkey", "bacon", "ham", "sausage", "duck", "meat", ...SEAFOOD];
const ANIMAL = [...MEAT_FISH, "egg", "milk", "cheese", "butter", "yogurt", "yoghurt", "cream", "honey", "gelatin"];
// Plant products whose names contain an animal word.
const PLANT_EXCEPTIONS = ["peanut butter", "almond butter", "coconut milk", "coconut cream", "soy milk", "oat milk", "almond milk", "rice milk"];

/** Lowercase, collapse spaces, naive singular. */
export function normalize(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(singular)
    .join(" ");
}

function singular(w) {
  if (w.length <= 3 || w.endsWith("ss")) return w;
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.endsWith("oes")) return w.slice(0, -2);
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}

/** True when every word of `term` appears in `name` (e.g. "soy sauce" ⊂ "dark soy sauce"). */
export function matchesTerm(name, term) {
  const words = new Set(normalize(name).split(" "));
  const t = normalize(term).split(" ").filter(Boolean);
  return t.length > 0 && t.every((w) => words.has(w));
}

/**
 * Pantry match: one name's words are all in the other AND they share the last
 * word (the head noun). "rice" covers "jasmine rice" but not "rice vinegar".
 */
export function pantryMatches(name, pantryItem) {
  const a = normalize(name).split(" ");
  const b = normalize(pantryItem).split(" ");
  if (!a[0] || !b[0] || a.at(-1) !== b.at(-1)) return false;
  return matchesTerm(name, pantryItem) || matchesTerm(pantryItem, name);
}

export function dietViolation(name, diet) {
  const n = normalize(name);
  if (PLANT_EXCEPTIONS.some((p) => n.includes(normalize(p)))) return undefined;
  const words = new Set(n.split(" "));
  const has = (list) => list.find((w) => words.has(w));
  if (diet === "vegan") return has(ANIMAL);
  if (diet === "vegetarian") return has(MEAT_FISH);
  if (diet === "pescatarian") return has(MEAT_FISH.filter((w) => !SEAFOOD.includes(w)));
  return undefined;
}

const round = (x, unit) => (unit === "count" ? Math.ceil(x * 100) / 100 : Math.round(x));

export function consolidate(plan, profile) {
  const warnings = [];
  const groups = new Map();

  for (const meal of plan.meals ?? []) {
    for (const ing of meal.ingredients ?? []) {
      if (!ing?.name || !(ing.quantity > 0)) continue;
      const key = normalize(ing.name);
      if (!key) continue;
      let g = groups.get(key);
      if (!g) {
        g = { key, name: ing.name.trim().toLowerCase(), category: ing.category ?? "other", amounts: {}, usedIn: [] };
        groups.set(key, g);
      }
      g.amounts[ing.unit] = (g.amounts[ing.unit] ?? 0) + ing.quantity;
      const label = `Day ${meal.day} ${meal.slot}: ${meal.name}`;
      if (!g.usedIn.includes(label)) g.usedIn.push(label);
    }
  }

  const toBuy = [];
  const pantryCovered = [];
  const removed = [];

  for (const g of groups.values()) {
    const item = {
      name: g.name,
      searchTerm: g.name,
      category: g.category,
      quantities: Object.entries(g.amounts).map(([unit, amount]) => ({ amount: round(amount, unit), unit })),
      usedIn: g.usedIn,
    };

    const allergen = profile.allergies.find((a) => matchesTerm(g.name, a));
    if (allergen) {
      removed.push({ ...item, reason: `matches allergy "${allergen}"` });
      warnings.push({ type: "allergy", message: `Removed "${g.name}": it matches your allergy "${allergen}". Check the meals that used it.` });
      continue;
    }
    const avoided = profile.avoid.find((a) => matchesTerm(g.name, a));
    if (avoided) {
      removed.push({ ...item, reason: `matches "${avoided}" on your avoid list` });
      warnings.push({ type: "avoid", message: `Removed "${g.name}": it's on your avoid list ("${avoided}").` });
      continue;
    }
    const dietHit = dietViolation(g.name, profile.diet);
    if (dietHit) {
      removed.push({ ...item, reason: `not ${profile.diet}` });
      warnings.push({ type: "diet", message: `Removed "${g.name}": not ${profile.diet}.` });
      continue;
    }
    const pantry = profile.pantry.find((p) => pantryMatches(g.name, p));
    if (pantry) {
      pantryCovered.push({ ...item, pantryItem: pantry });
      continue;
    }
    toBuy.push(item);
  }

  toBuy.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  if (toBuy.length > MAX_ITEMS) {
    warnings.push({ type: "long-list", message: `The list has ${toBuy.length} items; the agent works best with ${MAX_ITEMS} or fewer. Consider removing some.` });
  }
  if (typeof plan.estimatedTotal === "number" && plan.estimatedTotal > profile.budget) {
    warnings.push({ type: "budget", message: `The planner's rough estimate ($${plan.estimatedTotal.toFixed(2)}) is over your $${profile.budget} budget. Real prices are checked in the next step.` });
  }
  if (profile.allergies.length) {
    warnings.push({ type: "allergy-check", message: "Allergy filtering is a screening aid only. Always check product labels yourself." });
  }

  return { toBuy, pantryCovered, removed, warnings };
}
