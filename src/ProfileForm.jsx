import { useEffect, useState } from "react";
import { useApi } from "./api.js";
import { Button, Card, Icon, Notice } from "./ui.jsx";

const LIST_FIELDS = ["cuisines", "allergies", "avoid", "nutritionPrefs", "pantry"];
const toText = (list) => list.join(", ");
const toList = (text) => text.split(",").map((s) => s.trim()).filter(Boolean);

function toForm(profile) {
  const form = { ...profile };
  for (const f of LIST_FIELDS) form[f] = toText(profile[f] ?? []);
  delete form.updatedAt;
  return form;
}

function fromForm(form) {
  const body = {
    ...form,
    budget: Number(form.budget),
    householdSize: Number(form.householdSize),
    shoppingDays: Number(form.shoppingDays),
  };
  for (const f of LIST_FIELDS) body[f] = toList(form[f]);
  return body;
}

/**
 * The grocery profile, grouped into cards.
 * onLoaded(saved, profile) runs after loading; onSaved(profile) after a save.
 */
export default function ProfileForm({ onLoaded = () => {}, onSaved = () => {}, api: apiOverride = null }) {
  const authApi = useApi();
  const api = apiOverride ?? authApi;
  const [form, setForm] = useState(null);
  const [status, setStatus] = useState({ kind: "loading" });
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    api("/profile")
      .then(({ profile, saved }) => {
        setForm(toForm(profile));
        setStatus(saved ? { kind: "saved", at: profile.updatedAt } : { kind: "new" });
        onLoaded(saved, profile);
      })
      .catch((e) => setStatus({ kind: "error", message: describe(e) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    if (status.kind === "saved") setStatus({ kind: "dirty" });
  };

  async function onSubmit(e) {
    e.preventDefault();
    setStatus({ kind: "saving" });
    setFieldErrors({});
    try {
      const { profile } = await api("/profile", { method: "PUT", body: fromForm(form) });
      setForm(toForm(profile));
      setStatus({ kind: "saved", at: profile.updatedAt });
      onSaved(profile);
    } catch (err) {
      if (err.body?.fields) setFieldErrors(err.body.fields);
      setStatus({ kind: "error", message: describe(err) });
    }
  }

  if (!form) {
    return status.kind === "error" ? <Notice tone="danger">{status.message}</Notice> : <ProfileSkeleton />;
  }

  const field = (name, label, input, hint) => (
    <label className="field">
      <span className="field-label">{label}</span>
      {input}
      {hint && <small className="field-hint">{hint}</small>}
      {fieldErrors[name] && <small className="field-error">{fieldErrors[name]}</small>}
    </label>
  );

  return (
    <form onSubmit={onSubmit} className="stack">
      <div className="page-head">
        <div>
          <h1>Your grocery profile</h1>
          <p className="muted">Autocart plans meals and builds your cart around these.</p>
        </div>
      </div>

      <Card title="Budget & household" subtitle="What you want to spend, and for how many">
        <div className="form-grid">
          {field("budget", "Budget ($ CAD)", <input type="number" min="10" step="1" value={form.budget} onChange={set("budget")} />)}
          {field("householdSize", "People", <input type="number" min="1" max="12" value={form.householdSize} onChange={set("householdSize")} />)}
          {field("shoppingDays", "Days to shop for", <input type="number" min="1" max="14" value={form.shoppingDays} onChange={set("shoppingDays")} />)}
        </div>
      </Card>

      <Card title="Food preferences" subtitle="Comma-separated lists are fine">
        <div className="form-grid">
          {field("diet", "Diet", (
            <select value={form.diet} onChange={set("diet")}>
              <option value="none">No restriction</option>
              <option value="vegetarian">Vegetarian</option>
              <option value="vegan">Vegan</option>
              <option value="pescatarian">Pescatarian</option>
            </select>
          ))}
          {field("cookingPref", "Cooking style", (
            <select value={form.cookingPref} onChange={set("cookingPref")}>
              <option value="any">Any</option>
              <option value="quick">Quick meals</option>
              <option value="batch">Batch cooking</option>
              <option value="minimal-prep">Minimal prep</option>
            </select>
          ))}
        </div>
        <div className="form-grid wide">
          {field("cuisines", "Cuisines you enjoy", <input value={form.cuisines} onChange={set("cuisines")} placeholder="Korean, Italian" />)}
          {field("nutritionPrefs", "Nutrition preferences", <input value={form.nutritionPrefs} onChange={set("nutritionPrefs")} placeholder="high protein, fibre" />)}
          {field("allergies", "Allergies / ingredients to avoid", <input value={form.allergies} onChange={set("allergies")} placeholder="peanuts, shellfish" />,
            "A screening aid only. Always check product labels yourself.")}
          {field("avoid", "Foods or categories to skip", <input value={form.avoid} onChange={set("avoid")} placeholder="snacks, sugary drinks" />)}
        </div>
      </Card>

      <Card title="Pantry & store" subtitle="Skip what you have; shop at your T&T">
        <div className="form-grid wide">
          {field("pantry", "Already in your pantry", <textarea rows="2" value={form.pantry} onChange={set("pantry")} placeholder="rice, soy sauce, olive oil" />)}
          {field("postalCode", "Postal code", <input value={form.postalCode} onChange={set("postalCode")} placeholder="N6G 1A1" />,
            "Autocart learns what your nearest T&T stocks from each cart it builds.")}
        </div>
      </Card>

      <div className="form-footer">
        <StatusLine status={status} />
        <Button type="submit" disabled={status.kind === "saving"} icon={status.kind === "saved" ? "check" : undefined}>
          {status.kind === "saving" ? "Saving…" : status.kind === "saved" ? "Saved" : "Save & continue"}
        </Button>
      </div>
    </form>
  );
}

function ProfileSkeleton() {
  return (
    <div className="stack">
      {[0, 1, 2].map((i) => (
        <section key={i} className="card"><span className="skeleton" style={{ width: "40%", height: 18 }} />
          <div className="form-grid" style={{ marginTop: 16 }}>
            {[0, 1, 2].map((j) => <span key={j} className="skeleton" style={{ height: 40 }} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function StatusLine({ status }) {
  if (status.kind === "saved") return <span className="status-ok"><Icon name="check" size={14} /> Saved {status.at && `${new Date(status.at + "Z").toLocaleString()}`}</span>;
  if (status.kind === "new") return <span className="muted">Not saved yet. Defaults shown.</span>;
  if (status.kind === "dirty") return <span className="muted">Unsaved changes</span>;
  if (status.kind === "error") return <span className="field-error">{status.message}</span>;
  return <span />;
}

function describe(err) {
  if (err.status === 401) return "Your session isn't valid for Autocart. Try logging out and in again.";
  if (err.status === 403) return "Your login is missing an Autocart permission.";
  if (err.status === 400) return "Some fields need fixing.";
  if (err.error === "consent_required" || err.error === "login_required") return "Please log in again to grant Autocart access.";
  return err.message ?? "Something went wrong.";
}
