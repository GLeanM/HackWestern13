import { useState } from "react";
import { BudgetMeter, Button, Icon, Logo, Spinner, money } from "./ui.jsx";

export const STEPS = [
  { id: "profile", label: "Profile", icon: "user", hint: "Budget & tastes" },
  { id: "plan", label: "Meal plan", icon: "spark", hint: "Meals & list" },
  { id: "cart", label: "Cart", icon: "list", hint: "T&T prices" },
  { id: "build", label: "Build cart", icon: "cart", hint: "Agent shops" },
];

const STATUS_TEXT = {
  planning: "Planning meals…",
  planned: "Plan ready",
  researching: "Finding T&T prices…",
  priced: "Cart ready to review",
  building: "Agent is shopping…",
  built: "T&T cart built",
  failed: "Planning failed",
};

function initials(user) {
  const src = user?.name || user?.email || "?";
  return src.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
}

export function TopBar({ user, onLogout, task }) {
  const [open, setOpen] = useState(false);
  const busy = ["planning", "researching", "building"].includes(task?.status);
  return (
    <header className="topbar">
      <Logo />
      <div className="topbar-right">
        {task && (
          <span className={`status-pill ${busy ? "busy" : ""}`}>
            {busy ? <span className="pulse" aria-hidden="true" /> : <Icon name="check" size={12} />}
            {STATUS_TEXT[task.status] ?? task.status}
          </span>
        )}
        <div className="menu">
          <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
            {initials(user)}
          </button>
          {open && (
            <div className="menu-pop" role="menu">
              <div className="menu-user">
                <strong>{user?.name ?? "Signed in"}</strong>
                <span className="muted small">{user?.email}</span>
              </div>
              <button type="button" role="menuitem" className="menu-item" onClick={onLogout}>
                <Icon name="logout" size={16} /> Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/** Sidebar on desktop, pill bar on mobile. */
export function StepNav({ step, setStep, unlocked, done }) {
  return (
    <nav className="steps" aria-label="Steps">
      <ol>
        {STEPS.map((s, i) => {
          const locked = !unlocked.has(s.id);
          const isDone = done.has(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`step ${step === s.id ? "active" : ""} ${isDone ? "done" : ""}`}
                aria-current={step === s.id ? "step" : undefined}
                disabled={locked}
                onClick={() => setStep(s.id)}
              >
                <span className="step-num">{isDone ? <Icon name="check" size={14} /> : locked ? <Icon name="lock" size={12} /> : i + 1}</span>
                <span className="step-text">
                  <span className="step-label">{s.label}</span>
                  <span className="step-hint">{s.hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="steps-foot muted small">
        <Icon name="shield" size={14} /> Secured with Auth0 · Agent by TinyFish
      </p>
    </nav>
  );
}

/** Right rail on wide screens, sticky bar on small ones. */
export function Summary({ task, profile, step, setStep }) {
  const review = task?.review;
  const budget = review?.budget ?? profile?.budget ?? 0;
  const next = nextAction(task, step);

  return (
    <aside className="summary" aria-label="Cart summary">
      <div className="summary-inner">
        <h2 className="summary-title">Summary</h2>
        {review ? (
          <BudgetMeter total={review.total} budget={budget} />
        ) : task?.status === "researching" ? (
          <div className="summary-wait"><Spinner label="Pricing at T&T…" /></div>
        ) : (
          <p className="muted small">Budget {money(budget)}{profile ? ` · ${profile.householdSize} ${profile.householdSize === 1 ? "person" : "people"} · ${profile.shoppingDays} days` : ""}</p>
        )}
        {review && (
          <dl className="summary-stats">
            <div><dt>Items</dt><dd>{review.itemCount}</dd></div>
            <div><dt>For agent</dt><dd>{review.readyForAgent}</dd></div>
            {task.result?.meals && <div><dt>Meals</dt><dd>{task.result.meals.length}</dd></div>}
          </dl>
        )}
        {next && (
          <Button className="summary-cta" icon={next.icon} onClick={() => setStep(next.step)}>{next.label}</Button>
        )}
      </div>
    </aside>
  );
}

function nextAction(task, step) {
  if (!task) return step === "plan" ? null : { step: "plan", label: "Plan meals", icon: "spark" };
  if (task.status === "priced" && step !== "build") return { step: "build", label: "Build my T&T cart", icon: "cart" };
  if ((task.status === "researching" || task.status === "priced") && step === "plan") return { step: "cart", label: "View cart", icon: "list" };
  if ((task.status === "building" || task.status === "built") && step !== "build") return { step: "build", label: task.status === "building" ? "Watch the agent" : "See your T&T cart", icon: "cart" };
  return null;
}
