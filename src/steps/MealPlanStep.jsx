import { useState } from "react";
import { Button, Card, Icon, Notice, Skeleton, money } from "../ui.jsx";

const SLOT_ORDER = { breakfast: 0, lunch: 1, dinner: 2 };
const groupBy = (xs, key) => xs.reduce((acc, x) => ((acc[key(x)] ??= []).push(x), acc), {});

export default function MealPlanStep({ task, startPlan, error, profileSaved, goTo }) {
  const [note, setNote] = useState("");
  const [starting, setStarting] = useState(false);
  const busy = ["planning", "researching", "building"].includes(task?.status);
  const planning = task?.status === "planning" || starting;
  const result = task?.result?.meals ? task.result : null;

  async function submit(e) {
    e.preventDefault();
    setStarting(true);
    await startPlan(note);
    setStarting(false);
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Meal plan</h1>
          <p className="muted">Autocart plans your meals, then prices the shopping list at T&amp;T in the same go.</p>
        </div>
      </div>

      <Card className="plan-request">
        {!profileSaved ? (
          <Notice>
            Save your profile first. The planner uses your budget, diet, and pantry.{" "}
            <button type="button" className="link-btn" onClick={() => goTo("profile")}>Go to profile</button>
          </Notice>
        ) : (
          <form onSubmit={submit} className="plan-form">
            <label className="field grow">
              <span className="field-label">Anything specific this time? <span className="muted">(optional)</span></span>
              <textarea rows="2" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. more vegetables, one fish dinner, nothing spicy" />
            </label>
            <Button type="submit" disabled={busy || starting}>
              {planning ? "Planning…" : result ? "Plan again" : "Plan & price my groceries"}
            </Button>
          </form>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        {task?.status === "failed" && <Notice tone="danger">{task.error}</Notice>}
      </Card>

      {planning && !result && <PlanSkeleton />}

      {result && (
        <>
          <Card
            title="Your plan"
            subtitle={`${result.meals.length} meals · rough estimate ${money(result.estimatedTotal)} of your ${money(task.input.profile.budget)} budget`}
            actions={
              <Button variant="secondary" icon="list" onClick={() => goTo("cart")}>
                {task.status === "researching" ? "See prices come in" : "Go to cart"}
              </Button>
            }
          >
            <p className="lead">{result.summary}</p>
            {result.warnings.length > 0 && (
              <ul className="warnings">
                {result.warnings.map((w, i) => <li key={i} className={`warn-${w.type}`}>{w.message}</li>)}
              </ul>
            )}
            {result.pantryCovered.length > 0 && (
              <p className="pantry-line small">
                <span className="muted">Already in your pantry:</span> {result.pantryCovered.map((i) => i.name).join(", ")}
              </p>
            )}
          </Card>

          <WeekPlan meals={result.meals} />
        </>
      )}
    </div>
  );
}

function MealMeta({ meal }) {
  return meal.leftoversFromDay
    ? <span className="meal-meta leftovers">Leftovers from day {meal.leftoversFromDay}</span>
    : <span className="meal-meta"><Icon name="clock" size={12} /> {meal.prepMinutes} min</span>;
}

/** Days across, meals down on wide screens; one block per day on narrow ones. */
function WeekPlan({ meals }) {
  const byDay = groupBy(meals, (m) => m.day);
  const days = Object.keys(byDay);
  const slots = Object.keys(SLOT_ORDER).filter((slot) => meals.some((m) => m.slot === slot));
  const find = (day, slot) => byDay[day].find((m) => m.slot === slot);
  return (
    <>
      <div className="week-wrap">
        <table className="week">
          <thead>
            <tr><td />{days.map((d) => <th key={d} scope="col">Day {d}</th>)}</tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <tr key={slot}>
                <th scope="row">{slot}</th>
                {days.map((d) => {
                  const m = find(d, slot);
                  return (
                    <td key={d} className={m?.leftoversFromDay ? "is-leftover" : ""}>
                      {m ? <><span className="meal-name">{m.name}</span><MealMeta meal={m} /></> : <span className="muted">-</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="day-grid">
        {days.map((day) => (
          <article key={day} className="day-card">
            <h3>Day {day}</h3>
            <ul>
              {[...byDay[day]].sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]).map((m) => (
                <li key={m.slot}>
                  <span className="slot">{m.slot}</span>
                  <span className="meal-name">{m.name}</span>
                  <MealMeta meal={m} />
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </>
  );
}

function PlanSkeleton() {
  return (
    <>
      <section className="card">
        <Skeleton width="30%" height={20} />
        <div style={{ height: 12 }} />
        <Skeleton width="90%" />
        <div style={{ height: 8 }} />
        <Skeleton width="70%" />
        <p className="muted small" style={{ marginTop: 16 }}>Gemini is planning your meals… usually 10–30 seconds.</p>
      </section>
      <div className="day-grid always">
        {[0, 1, 2].map((d) => (
          <article key={d} className="day-card">
            <Skeleton width="40%" height={16} />
            {[0, 1, 2].map((m) => <div key={m} style={{ marginTop: 14 }}><Skeleton width="30%" height={10} /><div style={{ height: 6 }} /><Skeleton width="85%" /></div>)}
          </article>
        ))}
      </div>
    </>
  );
}
