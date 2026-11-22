import { useEffect, useRef, useState } from "react";
import { useApi } from "./api.js";
import PriceTable from "./PriceTable.jsx";

const POLL_MS = 2000;
const SLOT_ORDER = { breakfast: 0, lunch: 1, dinner: 2 };
const fmtQty = (qs) => qs.map((q) => (q.unit === "count" ? `${q.amount}` : `${q.amount} ${q.unit}`)).join(" + ");
const fmtCategory = (c) => c.replace(/-/g, " & ");

export default function PlanPanel({ profileSaved }) {
  const api = useApi();
  const [note, setNote] = useState("");
  const [task, setTask] = useState(null);
  const [error, setError] = useState("");
  const timer = useRef(null);

  // Resume the most recent task on load.
  useEffect(() => {
    api("/shopping-tasks")
      .then(({ tasks }) => tasks[0] && load(tasks[0].id))
      .catch(() => {});
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  async function load(id) {
    try {
      const { task } = await api(`/shopping-tasks/${id}`);
      setTask(task);
      if (task.status === "planning" || task.status === "researching") {
        timer.current = setTimeout(() => load(id), POLL_MS);
      }
    } catch (e) {
      setError(e.body?.message ?? "Couldn't load the plan.");
    }
  }

  async function start(e) {
    e.preventDefault();
    setError("");
    try {
      const { task } = await api("/shopping-tasks", { method: "POST", body: { note } });
      setTask(task);
      timer.current = setTimeout(() => load(task.id), POLL_MS);
    } catch (err) {
      setError(err.body?.message ?? (err.body?.fields ? Object.values(err.body.fields).join(" ") : "Couldn't start planning."));
    }
  }

  async function price() {
    setError("");
    try {
      const { task: t } = await api(`/shopping-tasks/${task.id}/research`, { method: "POST" });
      setTask(t);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => load(t.id), POLL_MS);
    } catch (err) {
      setError(err.body?.message ?? "Couldn't start the price search.");
    }
  }

  const planning = task?.status === "planning";
  const busy = planning || task?.status === "researching";
  const hasPlan = task && ["planned", "researching", "priced"].includes(task.status);

  return (
    <section className="card">
      <h2>Plan my groceries</h2>
      {!profileSaved ? (
        <p className="muted">Save your profile first. The planner uses your budget, diet, and pantry.</p>
      ) : (
        <form onSubmit={start}>
          <label className="field">
            <span>Anything specific this time? (optional)</span>
            <textarea rows="2" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. more vegetables, one fish dinner, nothing spicy" />
          </label>
          <div className="actions">
            <button type="submit" disabled={busy}>{planning ? "Planning…" : task ? "Plan again" : "Plan my groceries"}</button>
            {planning && <span className="muted">The planner usually takes 10–30 seconds.</span>}
            {error && <span className="error">{error}</span>}
          </div>
        </form>
      )}

      {task?.status === "failed" && <p className="error">{task.error}</p>}
      {hasPlan && (
        <PlanResult result={task.result} input={task.input}>
          <div className="price-cta">
            {task.status === "researching" ? (
              <p className="muted"><span className="spinner" aria-hidden="true" /> TinyFish is searching T&amp;T for each item… usually 30–60 seconds.</p>
            ) : (
              <div className="actions">
                <button type="button" onClick={price}>
                  {task.status === "priced" ? "Refresh T&T prices" : "Find prices on T&T"}
                </button>
                {task.error && <span className="error">{task.error}</span>}
              </div>
            )}
          </div>
          {task.result.research && <PriceTable research={task.result.research} stale={task.status === "researching"} />}
        </PlanResult>
      )}
    </section>
  );
}

function PlanResult({ result, input, children }) {
  const days = groupBy(result.meals, (m) => m.day);
  const byCategory = groupBy(result.toBuy, (i) => i.category);

  return (
    <div className="plan">
      <p>{result.summary}</p>
      <p className="muted">
        Rough estimate ${result.estimatedTotal?.toFixed(2)} of your ${input.profile.budget} budget. Real T&amp;T prices are checked in the next step.
      </p>

      {result.warnings.length > 0 && (
        <ul className="warnings">
          {result.warnings.map((w, i) => <li key={i} className={`warn-${w.type}`}>{w.message}</li>)}
        </ul>
      )}

      {children}

      <details className="shopping-details" open={!result.research}>
      <summary><h3>Shopping list ({result.toBuy.length} items)</h3></summary>
      {Object.entries(byCategory).map(([cat, items]) => (
        <div key={cat} className="list-group">
          <h4>{fmtCategory(cat)}</h4>
          <ul className="shopping">
            {items.map((i) => (
              <li key={i.name} title={i.usedIn.join("\n")}>
                <span>{i.name}</span>
                <span className="qty">{fmtQty(i.quantities)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      </details>

      {result.pantryCovered.length > 0 && (
        <p className="muted">Already in your pantry: {result.pantryCovered.map((i) => i.name).join(", ")}</p>
      )}

      <details>
        <summary>Meal plan ({result.meals.length} meals)</summary>
        {Object.entries(days).map(([day, meals]) => (
          <div key={day} className="day">
            <h4>Day {day}</h4>
            <ul>
              {[...meals].sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]).map((m) => (
                <li key={m.slot}>
                  <strong>{m.slot}:</strong> {m.name}
                  <span className="muted"> · {m.leftoversFromDay ? `leftovers from day ${m.leftoversFromDay}` : `${m.prepMinutes} min`}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </details>
    </div>
  );
}

function groupBy(xs, key) {
  return xs.reduce((acc, x) => ((acc[key(x)] ??= []).push(x), acc), {});
}
