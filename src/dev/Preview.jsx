// Dev-only design preview: renders the real app shell with sample data for
// every state, so the UI can be checked without signing in.
// Open http://localhost:5173/src/dev/preview.html?state=priced
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import { Shell } from "../App.jsx";
import Landing from "../Landing.jsx";
import ProfileForm from "../ProfileForm.jsx";
import { consolidate } from "../../server/planner/consolidate.js";
import { researchList } from "../../server/research/research.js";
import { summarize, defaultSelections } from "../../server/review/cart.js";
import { planCartRun } from "../../server/cart/buildCart.js";
import fixtures from "../../server/research/fixtures/tnt-search.json";

const STATES = ["landing", "profile", "planning", "researching", "priced", "building", "built"];
const profile = {
  budget: 100, householdSize: 1, shoppingDays: 3, diet: "none", cuisines: ["Korean", "Chinese"],
  allergies: ["peanuts"], avoid: ["sugary drinks"], nutritionPrefs: ["high protein"], cookingPref: "quick",
  postalCode: "N6G 1A1", pantry: ["rice", "soy sauce"],
};
const ing = (name, searchTerm, quantity, unit, category) => ({ name, searchTerm, quantity, unit, category });
const plan = {
  summary: "A quick, high-protein 3-day plan with Korean and Chinese flavours, built around tofu, eggs and chicken.",
  estimatedTotal: 52.5, model: "preview",
  meals: [
    { day: 1, slot: "breakfast", name: "Scallion egg scramble", servings: 1, prepMinutes: 10, leftoversFromDay: 0, ingredients: [ing("eggs", "large eggs", 3, "count", "dairy-eggs"), ing("green onions", "green onions", 30, "g", "produce")] },
    { day: 1, slot: "lunch", name: "Kimchi fried rice", servings: 1, prepMinutes: 15, leftoversFromDay: 0, ingredients: [ing("napa cabbage kimchi", "napa cabbage kimchi", 150, "g", "produce"), ing("jasmine rice", "jasmine rice", 150, "g", "pantry")] },
    { day: 1, slot: "dinner", name: "Garlic chicken & bok choy", servings: 1, prepMinutes: 25, leftoversFromDay: 0, ingredients: [ing("boneless chicken thighs", "chicken thighs", 400, "g", "meat-seafood"), ing("baby bok choy", "baby bok choy", 300, "g", "produce"), ing("garlic", "garlic", 20, "g", "produce")] },
    { day: 2, slot: "breakfast", name: "Tofu & egg scramble", servings: 1, prepMinutes: 10, leftoversFromDay: 0, ingredients: [ing("firm tofu", "firm tofu", 200, "g", "tofu-plant-protein"), ing("eggs", "large eggs", 2, "count", "dairy-eggs")] },
    { day: 2, slot: "lunch", name: "Chicken rice bowl", servings: 1, prepMinutes: 5, leftoversFromDay: 1, ingredients: [] },
    { day: 2, slot: "dinner", name: "Mapo tofu", servings: 1, prepMinutes: 20, leftoversFromDay: 0, ingredients: [ing("firm tofu", "firm tofu", 454, "g", "tofu-plant-protein"), ing("ground pork", "ground pork", 300, "g", "meat-seafood"), ing("garlic", "garlic", 15, "g", "produce")] },
    { day: 3, slot: "breakfast", name: "Steamed egg", servings: 1, prepMinutes: 15, leftoversFromDay: 0, ingredients: [ing("eggs", "large eggs", 3, "count", "dairy-eggs")] },
    { day: 3, slot: "lunch", name: "Mapo tofu", servings: 1, prepMinutes: 5, leftoversFromDay: 2, ingredients: [] },
    { day: 3, slot: "dinner", name: "Pork & kimchi stir-fry", servings: 1, prepMinutes: 20, leftoversFromDay: 0, ingredients: [ing("ground pork", "ground pork", 300, "g", "meat-seafood"), ing("napa cabbage kimchi", "napa cabbage kimchi", 150, "g", "produce"), ing("green onions", "green onions", 30, "g", "produce")] },
  ],
};
const fakeFetch = async (urls) =>
  new Map(urls.map((u) => [u, fixtures[decodeURIComponent(new URL(u).searchParams.get("query"))] ?? { ok: true, text: "Sorry! We couldn't find any products.", links: [], images: [] }]));

async function buildTasks() {
  const list = consolidate(plan, profile);
  const planResult = { summary: plan.summary, estimatedTotal: plan.estimatedTotal, model: "preview", meals: plan.meals, ...list };
  const research = await researchList(list.toBuy, profile, { fetchPages: fakeFetch });
  const selections = defaultSelections(research);
  const review = summarize(research, selections, profile.budget);
  const base = { id: "00000000-0000-4000-8000-000000000001", input: { note: "", profile }, error: null };
  const cartRun = planCartRun(review, { sub: "preview", approvedAt: new Date().toISOString(), total: review.total, itemCount: review.itemCount });
  const building = structuredClone(cartRun);
  building.startedAt = new Date(Date.now() - 95_000).toISOString();
  building.concurrency = 2;
  building.runs = [
    { batch: 0, attempt: 1, status: "RUNNING", streamingUrl: null, steps: 6, startedAt: new Date(Date.now() - 80_000).toISOString(), lastAction: "Add Superior Natural Firm Tofu to cart" },
    { batch: 1, attempt: 1, status: "RUNNING", streamingUrl: null, steps: 4, startedAt: new Date(Date.now() - 78_000).toISOString(), lastAction: "Navigate to ground pork search results" },
  ];
  building.items.forEach((it, i) => { if (i < 3) (it.outcome = "added"), (it.quantityInCart = it.packages); });
  const built = structuredClone(building);
  built.items.forEach((it, i) => { it.outcome = i === 4 ? "unavailable" : "added"; it.note = i === 4 ? "Not on the page at your store." : null; });
  built.runs.forEach((r) => (r.status = "COMPLETED"), (built.runs[0].runId = "preview-run"));
  Object.assign(built, { status: "partial", finishedAt: new Date().toISOString(), steps: 20, counts: { added: built.items.length - 1, outOfStock: 1, blocked: 0, cancelled: 0, failed: 0, skipped: built.skipped.length } });
  const priced = { ...base, status: "priced", result: { ...planResult, research, selections }, review };
  return {
    planning: { ...base, status: "planning", result: null },
    researching: { ...base, status: "researching", result: planResult },
    priced,
    building: { ...priced, status: "building", result: { ...priced.result, cartRun: building } },
    built: { ...priced, status: "built", result: { ...priced.result, cartRun: built } },
  };
}

function Preview() {
  const state = new URLSearchParams(location.search).get("state") ?? "priced";
  const [tasks, setTasks] = useState(null);
  const [task, setTask] = useState(null);
  useEffect(() => { buildTasks().then((t) => { setTasks(t); setTask(t[state] ?? null); }); }, [state]);
  const api = async (path) => (path === "/profile" ? { profile, saved: true } : { task });

  const bar = (
    <div style={{ position: "fixed", bottom: 12, left: 12, zIndex: 99, display: "flex", gap: 4, background: "#0b4f2e", padding: 6, borderRadius: 999, flexWrap: "wrap" }}>
      {STATES.map((s) => (
        <a key={s} href={`?state=${s}`} style={{ color: s === state ? "#0b4f2e" : "#fff", background: s === state ? "#fff" : "transparent", padding: "4px 10px", borderRadius: 999, fontSize: 12, textDecoration: "none", fontFamily: "Inter, sans-serif" }}>{s}</a>
      ))}
    </div>
  );
  if (state === "landing") return <>{<Landing onLogin={() => {}} onSignup={() => {}} />}{bar}</>;
  if (!tasks) return <p style={{ padding: 24 }}>Building sample data…</p>;
  return (
    <>
      <Shell
        user={{ name: "Michael Glean", email: "preview@example.com" }}
        onLogout={() => {}}
        api={api}
        task={state === "profile" ? tasks.priced : task}
        setTask={setTask}
        loaded
        error=""
        startPlan={async () => true}
        refreshPrices={async () => {}}
        reload={() => {}}
        initialProfile={profile}
        initialSaved
        forceStep={state === "profile" ? "profile" : null}
        renderProfile={(onLoaded, onSaved) => <ProfileForm api={api} onLoaded={onLoaded} onSaved={onSaved} />}
      />
      {bar}
    </>
  );
}

createRoot(document.getElementById("root")).render(<StrictMode><Preview /></StrictMode>);
