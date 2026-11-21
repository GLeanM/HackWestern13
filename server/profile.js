// Validation for the grocery profile. Hand-rolled to keep dependencies small.
// Returns { value } on success or { errors } with one message per bad field.

export const DIETS = ["none", "vegetarian", "vegan", "pescatarian"];
export const COOKING_PREFS = ["any", "quick", "batch", "minimal-prep"];

export const DEFAULT_PROFILE = {
  budget: 100,
  householdSize: 1,
  shoppingDays: 7,
  diet: "none",
  cuisines: [],
  allergies: [],
  avoid: [],
  nutritionPrefs: [],
  cookingPref: "any",
  postalCode: "",
  pantry: [],
};

const MAX_LIST = 50;
const MAX_ITEM = 80;
// Canadian postal code or FSA (e.g. "N6G" or "N6G 1A1").
const POSTAL_RE = /^[A-Za-z]\d[A-Za-z](?:\s?\d[A-Za-z]\d)?$/;

function stringList(value, field, errors) {
  if (!Array.isArray(value)) {
    errors[field] = "must be an array of strings";
    return [];
  }
  if (value.length > MAX_LIST) {
    errors[field] = `at most ${MAX_LIST} entries`;
    return [];
  }
  const out = [];
  for (const item of value) {
    if (typeof item !== "string") {
      errors[field] = "must be an array of strings";
      return [];
    }
    const trimmed = item.trim();
    if (trimmed.length > MAX_ITEM) {
      errors[field] = `entries must be ${MAX_ITEM} characters or fewer`;
      return [];
    }
    if (trimmed && !out.some((x) => x.toLowerCase() === trimmed.toLowerCase())) {
      out.push(trimmed);
    }
  }
  return out;
}

function number(value, field, { min, max, integer }, errors) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors[field] = "must be a number";
    return undefined;
  }
  if (integer && !Number.isInteger(value)) {
    errors[field] = "must be a whole number";
    return undefined;
  }
  if (value < min || value > max) {
    errors[field] = `must be between ${min} and ${max}`;
    return undefined;
  }
  return value;
}

function oneOf(value, field, allowed, errors) {
  if (!allowed.includes(value)) {
    errors[field] = `must be one of: ${allowed.join(", ")}`;
    return undefined;
  }
  return value;
}

export function validateProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { errors: { body: "must be a JSON object" } };
  }
  const errors = {};
  const known = new Set(Object.keys(DEFAULT_PROFILE));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) errors[key] = "unknown field";
  }

  // Missing fields fall back to defaults so the client can send partial forms.
  const src = { ...DEFAULT_PROFILE, ...input };
  const value = {
    budget: number(src.budget, "budget", { min: 10, max: 2000 }, errors),
    householdSize: number(src.householdSize, "householdSize", { min: 1, max: 12, integer: true }, errors),
    shoppingDays: number(src.shoppingDays, "shoppingDays", { min: 1, max: 14, integer: true }, errors),
    diet: oneOf(src.diet, "diet", DIETS, errors),
    cuisines: stringList(src.cuisines, "cuisines", errors),
    allergies: stringList(src.allergies, "allergies", errors),
    avoid: stringList(src.avoid, "avoid", errors),
    nutritionPrefs: stringList(src.nutritionPrefs, "nutritionPrefs", errors),
    cookingPref: oneOf(src.cookingPref, "cookingPref", COOKING_PREFS, errors),
    postalCode: "",
    pantry: stringList(src.pantry, "pantry", errors),
  };

  if (typeof src.postalCode !== "string") {
    errors.postalCode = "must be a string";
  } else {
    const pc = src.postalCode.trim().toUpperCase();
    if (pc && !POSTAL_RE.test(pc)) errors.postalCode = "must be a Canadian postal code, e.g. N6G 1A1";
    value.postalCode = pc;
  }

  if (Object.keys(errors).length) return { errors };
  value.budget = Math.round(value.budget * 100) / 100;
  return { value };
}
