import { test } from "node:test";
import assert from "node:assert/strict";
import { consolidate, normalize, pantryMatches, dietViolation } from "./consolidate.js";

const profile = (over = {}) => ({
  budget: 100, householdSize: 1, shoppingDays: 3, diet: "none",
  cuisines: [], allergies: [], avoid: [], nutritionPrefs: [], cookingPref: "any",
  postalCode: "", pantry: [], ...over,
});
const meal = (day, ingredients) => ({ day, slot: "dinner", name: `Meal ${day}`, servings: 1, prepMinutes: 20, leftoversFromDay: 0, ingredients });
const ing = (name, quantity, unit = "g", category = "produce") => ({ name, quantity, unit, category });

test("normalize singularises simply", () => {
  assert.equal(normalize("Tomatoes"), "tomato");
  assert.equal(normalize("Baby Bok Choys"), "baby bok choy");
  assert.equal(normalize("berries"), "berry");
  assert.equal(normalize("glass"), "glass");
});

test("pantry matching uses the head noun", () => {
  assert.ok(pantryMatches("jasmine rice", "rice"));
  assert.ok(pantryMatches("rice", "jasmine rice"));
  assert.ok(pantryMatches("dark soy sauce", "soy sauce"));
  assert.ok(!pantryMatches("rice vinegar", "rice"));
  assert.ok(!pantryMatches("rice noodles", "rice"));
});

test("diet checks use whole words and plant exceptions", () => {
  assert.equal(dietViolation("eggplant", "vegan"), undefined);
  assert.equal(dietViolation("eggs", "vegan"), "egg");
  assert.equal(dietViolation("peanut butter", "vegan"), undefined);
  assert.equal(dietViolation("coconut milk", "vegan"), undefined);
  assert.equal(dietViolation("chicken thighs", "vegetarian"), "chicken");
  assert.equal(dietViolation("salmon fillet", "pescatarian"), undefined);
  assert.equal(dietViolation("pork belly", "pescatarian"), "pork");
  assert.equal(dietViolation("tofu", "vegan"), undefined);
});

test("merges same ingredient across meals and keeps different units separate", () => {
  const { toBuy } = consolidate({ meals: [
    meal(1, [ing("Onions", 1, "count"), ing("milk", 200, "ml", "dairy-eggs")]),
    meal(2, [ing("onion", 2, "count"), ing("onion", 50, "g")]),
  ] }, profile());
  const onion = toBuy.find((i) => i.name === "onions");
  assert.deepEqual(onion.quantities, [{ amount: 3, unit: "count" }, { amount: 50, unit: "g" }]);
  assert.equal(onion.usedIn.length, 2);
});

test("removes allergens, avoided foods, and diet violations with warnings", () => {
  const r = consolidate({ estimatedTotal: 150, meals: [meal(1, [
    ing("peanut sauce", 30, "ml"), ing("cola", 500, "ml"), ing("chicken breast", 300), ing("broccoli", 200),
  ])] }, profile({ allergies: ["peanuts"], avoid: ["cola"], diet: "vegetarian" }));
  assert.deepEqual(r.toBuy.map((i) => i.name), ["broccoli"]);
  assert.deepEqual(r.removed.map((i) => i.name).sort(), ["chicken breast", "cola", "peanut sauce"]);
  const types = r.warnings.map((w) => w.type).sort();
  assert.deepEqual(types, ["allergy", "allergy-check", "avoid", "budget", "diet"]);
});

test("warns when the list is too long; ignores junk ingredients", () => {
  const many = Array.from({ length: 14 }, (_, i) => ing(`veg${i}`, 100));
  const r = consolidate({ meals: [meal(1, [...many, ing("", 1), ing("salt", 0)])] }, profile());
  assert.equal(r.toBuy.length, 14);
  assert.ok(r.warnings.some((w) => w.type === "long-list"));
});
