import { useState } from "react";
import { applyEdits, defaultSelections, summarize, optionsOf, MAX_PACKAGES } from "../server/review/cart.js";

const money = (x) => `$${x.toFixed(2)}`;
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const STATUS = {
  matched: { label: "Matched", cls: "chip-ok" },
  uncertain: { label: "Check", cls: "chip-warn" },
  not_found: { label: "Not found", cls: "chip-bad" },
};

const FLAG_TEXT = {
  "check-quantity": "Couldn't compare the size with what the recipes need. Check the quantity.",
  "estimated-quantity": "Quantity estimated from a typical piece/bunch weight.",
  "price-by-weight": "Sold by weight; the final price depends on the pack.",
  "weight-estimated": "Pack weight unknown; priced for about 1 lb.",
  "no-link": "No product link, so the agent can't add this. Swap or remove it.",
  "store-swapped": "Switched automatically: the first choice wasn't stocked at your T&T store last time.",
  "not-at-your-store": "Your T&T store didn't have this last time. Pick another option or search again.",
};

function sizeLabel(p) {
  if (!p?.size) return "pack";
  return p.size.label ?? `${p.size.amount}${p.size.unit === "count" ? "" : p.size.unit}`;
}

function ProductLine({ p }) {
  return (
    <div className="product">
      {p.image ? <img src={p.image} alt="" loading="lazy" /> : <div className="img-placeholder" aria-hidden="true" />}
      <div>
        <div className="product-name">
          {p.url ? <a href={p.url} target="_blank" rel="noreferrer">{p.name}</a> : p.name}
        </div>
        <div className="muted">
          {money(p.price ?? p.packPrice)}{p.perLb ? "/lb" : ""}
          {p.wasPrice != null && <s> {money(p.wasPrice)}{p.perLb ? "/lb" : ""}</s>}
          {p.discountPct != null && <span className="badge-sale">-{p.discountPct}%</span>}
          {p.unitPrice && <> · {money(p.unitPrice.value)}/{p.unitPrice.per}</>}
          {p.note && <> · {p.note}</>}
        </div>
      </div>
    </div>
  );
}

/**
 * Review and edit the priced cart. Edits apply instantly using the same logic
 * as the server (server/review/cart.js), then the server's answer replaces it.
 */
export default function ReviewCart({ task, setTask, api, stale }) {
  const research = task.result.research;
  const selections = task.result.selections ?? defaultSelections(research);
  const review = task.review ?? summarize(research, selections, research.budget);
  const [error, setError] = useState("");
  const [openOptions, setOpenOptions] = useState(null);
  const [search, setSearch] = useState(null); // { index, text, running, message }
  const editable = (task.status === "priced" || task.status === "built") && !stale && !search?.running;

  async function edit(edits) {
    setError("");
    const local = applyEdits(research, selections, edits);
    if (local.errors) return setError(local.errors[0].message);
    const before = task;
    const optimistic = {
      ...task,
      result: { ...task.result, selections: local.selections },
      review: summarize(research, local.selections, research.budget),
    };
    setTask(optimistic);
    try {
      const { task: saved } = await api(`/shopping-tasks/${task.id}/cart`, { method: "PATCH", body: { edits } });
      setTask(saved);
    } catch (err) {
      setTask(before);
      setError(err.body?.message ?? err.body?.fields?.[0]?.message ?? "Couldn't save that change.");
    }
  }

  async function runSearch(e) {
    e.preventDefault();
    const { index, text } = search;
    setSearch({ ...search, running: true, message: "" });
    setError("");
    try {
      const res = await api(`/shopping-tasks/${task.id}/items/${index}/search`, { method: "POST", body: { query: text } });
      setTask(res.task);
      setSearch(res.found ? null : { index, text, running: false, message: res.message });
      if (res.found) setOpenOptions(null);
    } catch (err) {
      setSearch({ index, text, running: false, message: err.body?.message ?? "Search failed." });
    }
  }

  const pct = Math.min(100, (review.total / review.budget) * 100);

  return (
    <div className={`prices${stale ? " stale" : ""}`}>
      <h3>Review your cart</h3>
      <p className="muted">Swap products, change pack counts, or remove what you don't need. Nothing is added to your T&amp;T cart until you approve it.</p>

      {review.warnings.length > 0 && (
        <ul className="warnings">
          {review.warnings.map((w, i) => <li key={i} className={`warn-${w.type}`}>{w.message}</li>)}
        </ul>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      <ul className="price-list">
        {review.lines.map((line) => {
          const item = research.items[line.index];
          const opts = optionsOf(item);
          const ed = (changes) => edit([{ index: line.index, name: line.name, ...changes }]);
          const searching = search?.index === line.index;
          return (
            <li key={line.index} className={`price-item${line.removed ? " removed" : ""}`}>
              <div className="price-head">
                <span className="item-name">{line.name}</span>
                <span className={`chip ${line.removed ? "chip-muted" : STATUS[line.status].cls}`}>
                  {line.removed ? "Removed" : STATUS[line.status].label}
                </span>
              </div>

              {line.missing ? (
                <p className="muted">No match for “{line.query}” on T&amp;T.</p>
              ) : line.removed ? null : (
                <div className="price-body">
                  <ProductLine p={line.product} />
                  <div className="line-cost">
                    <strong>{money(line.cost)}</strong>
                    <span className="muted">{sizeLabel(line.product)} each</span>
                  </div>
                </div>
              )}

              {!line.removed && line.flags.length > 0 && (
                <ul className="flags">{line.flags.map((f) => <li key={f}>{FLAG_TEXT[f] ?? f}</li>)}</ul>
              )}

              <div className="row-actions">
                {!line.missing && !line.removed && (
                  <div className="stepper" role="group" aria-label={`Packs of ${line.name}`}>
                    <button type="button" className="secondary" aria-label="One fewer pack"
                      disabled={!editable || line.packages <= 1} onClick={() => ed({ packages: line.packages - 1 })}>−</button>
                    <span aria-live="polite">{line.packages} pack{line.packages > 1 ? "s" : ""}</span>
                    <button type="button" className="secondary" aria-label="One more pack"
                      disabled={!editable || line.packages >= MAX_PACKAGES} onClick={() => ed({ packages: line.packages + 1 })}>+</button>
                  </div>
                )}
                {!line.removed && opts.length > 1 && (
                  <button type="button" className="link-btn" disabled={!editable}
                    aria-expanded={openOptions === line.index}
                    onClick={() => setOpenOptions(openOptions === line.index ? null : line.index)}>
                    Change ({opts.length - 1} other{opts.length > 2 ? "s" : ""})
                  </button>
                )}
                <button type="button" className="link-btn" disabled={!editable}
                  onClick={() => setSearch(searching ? null : { index: line.index, text: line.query ?? line.name, running: false, message: "" })}>
                  Search again
                </button>
                {!line.missing && (
                  <button type="button" className="link-btn" disabled={!editable}
                    onClick={() => ed({ removed: !line.removed })}>
                    {line.removed ? "Restore" : "Remove"}
                  </button>
                )}
              </div>

              {openOptions === line.index && !line.removed && (
                <fieldset className="options">
                  <legend className="sr-only">Choose a product for {line.name}</legend>
                  {opts.map((o, i) => (
                    <label key={o.url ?? o.name} className={`option${i === line.option ? " selected" : ""}`}>
                      <input type="radio" name={`opt-${line.index}`} checked={i === line.option} disabled={!editable}
                        onChange={() => { ed({ option: i }); setOpenOptions(null); }} />
                      <ProductLine p={o} />
                      <span className="muted nowrap">{o.packages} × = {money(o.cost)}</span>
                    </label>
                  ))}
                </fieldset>
              )}

              {searching && (
                <form className="search-again" onSubmit={runSearch}>
                  <label className="sr-only" htmlFor={`q-${line.index}`}>Search T&amp;T for {line.name}</label>
                  <input id={`q-${line.index}`} value={search.text} maxLength={60} disabled={search.running}
                    onChange={(e) => setSearch({ ...search, text: e.target.value })} />
                  <button type="submit" disabled={search.running || !search.text.trim()}>
                    {search.running ? "Searching…" : "Search T&T"}
                  </button>
                  {search.running && <span className="muted"><span className="spinner" aria-hidden="true" /> TinyFish is checking T&amp;T (~30s)</span>}
                  {search.message && <span className="error">{search.message}</span>}
                </form>
              )}
            </li>
          );
        })}
      </ul>

      <div className="total-bar">
        <div className="total-row">
          <div>
            <strong>Total {money(review.total)}</strong>
            <span className="muted"> · {review.itemCount} item{review.itemCount === 1 ? "" : "s"}</span>
          </div>
          <span className={review.overBudget ? "error" : "ok"}>
            {review.overBudget ? `${money(-review.remaining)} over budget` : `${money(review.remaining)} left of ${money(review.budget)}`}
          </span>
        </div>
        <div className={`budget-bar${review.overBudget ? " over" : ""}`} role="meter" aria-valuemin={0}
          aria-valuemax={review.budget} aria-valuenow={review.total} aria-label="Total against budget">
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="muted small">
          {task.status === "built"
            ? "Changing anything here sends the cart back for approval."
            : `Next: approve below and CartPilot's agent adds these ${review.readyForAgent} items to your T&T cart. You check out yourself.`}
        </p>
      </div>

      <p className="muted small">
        Prices retrieved {fmtTime(research.retrievedAt)} by TinyFish. {research.storeNote}
        {research.store?.knownProducts > 0 &&
          ` CartPilot also knows the stock of ${research.store.knownProducts} product${research.store.knownProducts === 1 ? "" : "s"} at your ${research.store.fsa} store from past cart builds.`}
      </p>
    </div>
  );
}
