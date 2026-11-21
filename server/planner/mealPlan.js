// Turns a saved grocery profile into a structured meal plan via an LLM.
// The LLM only proposes meals and per-meal ingredients; all list maths
// (merging, pantry removal, exclusion checks) happens in consolidate.js.

import { generateJson } from "./gemini.js";

export const UNITS = ["g", "ml", "count"];
export const SLOTS = ["breakfast", "lunch", "dinner"];
export const CATEGORIES = ["produce", "meat-seafood", "dairy-eggs", "bakery", "pantry", "frozen", "tofu-plant-protein", "condiments-sauces", "other"];
export const MAX_ITEMS = 12;

export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    meals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          day: { type: "integer", description: "1-based day number" },
          slot: { type: "string", enum: SLOTS },
          name: { type: "string" },
          servings: { type: "integer" },
          prepMinutes: { type: "integer" },
          leftoversFromDay: { type: "integer", description: "If this meal is leftovers of an earlier cooked meal, that day number; otherwise 0" },
          ingredients: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Generic grocery product name to search for, e.g. 'chicken thighs', 'baby bok choy', 'jasmine rice'" },
                quantity: { type: "number" },
                unit: { type: "string", enum: UNITS },
                category: { type: "string", enum: CATEGORIES },
              },
              required: ["name", "quantity", "unit", "category"],
            },
          },
        },
        required: ["day", "slot", "name", "servings", "prepMinutes", "leftoversFromDay", "ingredients"],
      },
    },
    estimatedTotal: { type: "number", description: "Rough grocery cost in CAD for everything to buy" },
    summary: { type: "string", description: "One or two sentences describing the plan" },
  },
  required: ["meals", "estimatedTotal", "summary"],
};

const SYSTEM = `You are CartPilot's meal planner. You plan practical, budget-aware home meals for groceries bought at T&T Supermarket in Canada (a large Asian supermarket that also stocks everyday Western groceries).
Rules:
- Plan breakfast, lunch and dinner for every day requested, scaled to the household size.
- Reuse ingredients across meals and use leftovers so the shopping list stays short: at most ${MAX_ITEMS} distinct ingredients to buy, not counting pantry items.
- Ingredient names must be generic grocery products a shopper would search for (no brands, no preparation words like "diced").
- Quantities in metric: grams (g), millilitres (ml), or a count. Give the total amount the meal uses.
- Never include any allergen or avoided food the user lists, including as a minor ingredient. Respect the diet strictly.
- Assume salt, pepper, cooking oil and water are available. Include pantry items in recipes where useful (they will not be bought).
- Keep the estimated total within the budget; prefer cheaper staples when the budget is tight.
- The "User note" is the shopper's own request; follow it when it does not conflict with these rules.`;

export function buildPrompt(profile, note = "") {
  const list = (xs) => (xs?.length ? xs.join(", ") : "none");
  return [
    `Budget: $${profile.budget} CAD total`,
    `People: ${profile.householdSize}`,
    `Days: ${profile.shoppingDays}`,
    `Diet: ${profile.diet}`,
    `Cuisines they enjoy: ${list(profile.cuisines)}`,
    `Nutrition preferences: ${list(profile.nutritionPrefs)}`,
    `Cooking style: ${profile.cookingPref}`,
    `ALLERGIES (never include): ${list(profile.allergies)}`,
    `Foods/categories to avoid: ${list(profile.avoid)}`,
    `Already in pantry: ${list(profile.pantry)}`,
    "",
    `User note: ${note.trim() || "none"}`,
  ].join("\n");
}

/** Factory so the app can be tested with a fake planner. */
export function createGeminiPlanner({ apiKey, models, thinkingLevel }) {
  return async function plan(profile, note) {
    const { data, model } = await generateJson({
      apiKey,
      models,
      thinkingLevel,
      system: SYSTEM,
      prompt: buildPrompt(profile, note),
      schema: PLAN_SCHEMA,
    });
    return { ...data, model };
  };
}
