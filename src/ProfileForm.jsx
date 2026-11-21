import { useEffect, useState } from "react";
import { useApi } from "./api.js";

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

export default function ProfileForm({ onSaved = () => {} }) {
  const api = useApi();
  const [form, setForm] = useState(null);
  const [status, setStatus] = useState({ kind: "loading" });
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    api("/profile")
      .then(({ profile, saved }) => {
        setForm(toForm(profile));
        setStatus(saved ? { kind: "saved", at: profile.updatedAt } : { kind: "new" });
        onSaved(saved);
      })
      .catch((e) => setStatus({ kind: "error", message: describe(e) }));
  }, [api]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setStatus({ kind: "saving" });
    setFieldErrors({});
    try {
      const { profile } = await api("/profile", { method: "PUT", body: fromForm(form) });
      setForm(toForm(profile));
      setStatus({ kind: "saved", at: profile.updatedAt });
      onSaved(true);
    } catch (err) {
      if (err.body?.fields) setFieldErrors(err.body.fields);
      setStatus({ kind: "error", message: describe(err) });
    }
  }

  if (!form) {
    return status.kind === "error" ? <p className="error">{status.message}</p> : <p>Loading profile…</p>;
  }

  const field = (name, label, input, hint) => (
    <label className="field">
      <span>{label}</span>
      {input}
      {hint && <small>{hint}</small>}
      {fieldErrors[name] && <small className="error">{fieldErrors[name]}</small>}
    </label>
  );

  return (
    <form onSubmit={onSubmit} className="card">
      <details open={status.kind !== "saved"}>
      <summary><h2>Your grocery profile</h2></summary>
      <div className="grid">
        {field("budget", "Budget ($ CAD)", <input type="number" min="10" step="1" value={form.budget} onChange={set("budget")} />)}
        {field("householdSize", "People", <input type="number" min="1" max="12" value={form.householdSize} onChange={set("householdSize")} />)}
        {field("shoppingDays", "Days to shop for", <input type="number" min="1" max="14" value={form.shoppingDays} onChange={set("shoppingDays")} />)}
        {field("postalCode", "Postal code", <input value={form.postalCode} onChange={set("postalCode")} placeholder="N6G 1A1" />, "Used to pick your T&T store")}
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
      {field("cuisines", "Cuisines you enjoy", <input value={form.cuisines} onChange={set("cuisines")} placeholder="Korean, Italian" />, "Comma-separated")}
      {field("nutritionPrefs", "Nutrition preferences", <input value={form.nutritionPrefs} onChange={set("nutritionPrefs")} placeholder="high protein, fibre" />)}
      {field("allergies", "Allergies / ingredients to avoid", <input value={form.allergies} onChange={set("allergies")} placeholder="peanuts, shellfish" />, "A screening aid only — always check product labels yourself.")}
      {field("avoid", "Foods or categories to skip", <input value={form.avoid} onChange={set("avoid")} placeholder="snacks, sugary drinks" />)}
      {field("pantry", "Already in your pantry", <textarea rows="2" value={form.pantry} onChange={set("pantry")} placeholder="rice, soy sauce, olive oil" />)}
      <div className="actions">
        <button type="submit" disabled={status.kind === "saving"}>
          {status.kind === "saving" ? "Saving…" : "Save profile"}
        </button>
        <StatusLine status={status} />
      </div>
      </details>
    </form>
  );
}

function StatusLine({ status }) {
  if (status.kind === "saved") return <span className="ok">Saved {status.at && `(${status.at} UTC)`}</span>;
  if (status.kind === "new") return <span className="muted">Not saved yet — defaults shown</span>;
  if (status.kind === "error") return <span className="error">{status.message}</span>;
  return null;
}

function describe(err) {
  if (err.status === 401) return "Your session isn't valid for the CartPilot API. Try logging out and in again.";
  if (err.status === 403) return "Your login is missing a CartPilot permission.";
  if (err.status === 400) return "Some fields need fixing.";
  if (err.error === "consent_required" || err.error === "login_required") return "Please log in again to grant CartPilot access.";
  return err.message ?? "Something went wrong.";
}
