import { useState } from "react";

const OUTCOME = {
  pending: { label: "Working…", cls: "chip-muted" },
  added: { label: "Added", cls: "chip-ok" },
  updated: { label: "Quantity set", cls: "chip-ok" },
  out_of_stock: { label: "Out of stock", cls: "chip-bad" },
  unavailable: { label: "Not at your store", cls: "chip-bad" },
  failed: { label: "Failed", cls: "chip-bad" },
  blocked: { label: "Blocked by T&T", cls: "chip-warn" },
  cancelled: { label: "Stopped", cls: "chip-muted" },
};
const STATUS_TEXT = {
  building: "The agent is adding your items to T&T…",
  built: "Your T&T cart is ready.",
  partial: "Most items are in your T&T cart. Check the ones below.",
  failed: "The agent couldn't add your items.",
  cancelled: "You stopped the agent.",
};
const T_AND_T_HOME = "https://www.tntsupermarket.com/eng/";
const STEP_COST = 0.016; // TinyFish agent price per step (USD)
const elapsed = (from, to = Date.now()) => {
  const s = Math.max(0, Math.round((new Date(to) - new Date(from)) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};

export default function CartBuild({ cartRun, building, taskId, api, onUpdate }) {
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState("");
  if (!cartRun) return null;

  async function stop() {
    setStopping(true);
    setStopError("");
    try {
      const { task } = await api(`/shopping-tasks/${taskId}/build-cart/cancel`, { method: "POST" });
      onUpdate(task);
    } catch (err) {
      setStopping(false);
      setStopError(err.body?.message ?? "Couldn't stop the agent.");
    }
  }
  const live = cartRun.runs?.filter((r) => r.status !== "COMPLETED" && r.status !== "FAILED" && r.status !== "CANCELLED") ?? [];
  const status = building ? "building" : cartRun.status;

  return (
    <section className="cart-build card" aria-live="polite">
      <div className="build-head">
        <h3>{STATUS_TEXT[status] ?? "Cart build"}</h3>
        {building && api && (
          <button type="button" className="btn btn-danger" onClick={stop} disabled={stopping}>
            {stopping ? "Stopping…" : "Stop agent"}
          </button>
        )}
      </div>
      {building && (
        <p className="muted small">
          {cartRun.retrying
            ? "T&T blocked part of the first attempt, so the agent is retrying those items in a fresh session."
            : `${(cartRun.concurrency ?? 1) > 1 ? `${cartRun.concurrency} agents at once` : "One agent at a time, so T&T doesn't block it"}. Started ${elapsed(cartRun.startedAt)} ago. If you stop, items already added stay in your T&T cart.`}
        </p>
      )}
      {stopError && <p className="error small" role="alert">{stopError}</p>}

      {building && (
        <div className="live-grid">
          {(live.length ? live : cartRun.runs ?? []).slice(0, 2).map((r) => (
            <div key={r.batch} className="live-frame">
              {r.streamingUrl ? (
                <iframe src={r.streamingUrl} title={`TinyFish agent ${r.batch + 1} live browser`} sandbox="allow-scripts allow-same-origin" />
              ) : (
                <div className="live-placeholder">
                  <span className="spinner" aria-hidden="true" /> Starting a browser signed in to T&amp;T…
                </div>
              )}
              <span className="muted small">
                Agent {r.batch + 1}{r.attempt > 1 ? " (retry)" : ""} · {r.status.toLowerCase()}
                {r.startedAt ? ` · ${elapsed(r.startedAt)}` : ""}{r.steps ? ` · ${r.steps} steps` : ""}
              </span>
              {r.lastAction && <span className="agent-action">Agent: {r.lastAction}</span>}
            </div>
          ))}
        </div>
      )}

      <ul className="outcomes">
        {cartRun.items.map((it) => (
          <li key={it.url}>
            <div className="outcome-head">
              <span>
                <span className="item-name">{it.name}</span>
                <span className="muted"> · {it.packages} × {it.productName}</span>
              </span>
              <span className={`chip ${OUTCOME[it.outcome]?.cls ?? "chip-muted"}`}>
                {it.outcome === "pending" && building && <span className="spinner" aria-hidden="true" />}
                {OUTCOME[it.outcome]?.label ?? it.outcome}
              </span>
            </div>
            {it.note && it.outcome !== "added" && it.outcome !== "updated" && <p className="muted small">{it.note}</p>}
            {it.note && /expected/.test(it.note) && (it.outcome === "added" || it.outcome === "updated") && (
              <p className="error small">{it.note}</p>
            )}
          </li>
        ))}
      </ul>

      {cartRun.skipped?.length > 0 && (
        <p className="muted small">Not sent to the agent: {cartRun.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}.</p>
      )}

      {!building && (
        <div className="build-done">
          {cartRun.counts && (
            <p>
              {cartRun.counts.added} added
              {cartRun.counts.outOfStock ? ` · ${cartRun.counts.outOfStock} out of stock` : ""}
              {cartRun.counts.blocked ? ` · ${cartRun.counts.blocked} blocked by T&T` : ""}
              {cartRun.counts.cancelled ? ` · ${cartRun.counts.cancelled} not done (stopped)` : ""}
              {cartRun.counts.failed ? ` · ${cartRun.counts.failed} failed` : ""}
              {cartRun.finishedAt && ` · took ${elapsed(cartRun.startedAt, cartRun.finishedAt)}`}
              {cartRun.steps ? ` · ${cartRun.steps} agent steps (≈ $${(cartRun.steps * STEP_COST).toFixed(2)})` : ""}
            </p>
          )}
          {cartRun.counts?.outOfStock > 0 && (
            <p className="muted small">
              Autocart's prices come from T&amp;T's online catalogue, but your store doesn't stock everything. Pick another option for those items in the review above and rebuild, or choose a substitute on T&amp;T.
            </p>
          )}
          {cartRun.counts?.blocked > 0 && (
            <p className="muted small">
              T&amp;T's website blocked the agent for some items. Wait a few minutes and use "Rebuild cart" below (only those items still need adding), or add them on T&amp;T yourself.
            </p>
          )}
          <div className="actions">
            <a className="btn btn-primary" href={cartRun.cartUrl ?? T_AND_T_HOME} target="_blank" rel="noreferrer">Open my T&amp;T cart</a>
            <span className="muted">Choose delivery or pickup and check out on T&amp;T yourself. Autocart never pays.</span>
          </div>
          <p className="muted small">
            Your T&amp;T cart also keeps anything that was already in it. T&amp;T shows the final subtotal once you pick delivery or pickup.
          </p>
          <p className="muted small">
            Approved {new Date(cartRun.approval.approvedAt).toLocaleString()} with the build:cart permission.{" "}
            {cartRun.runs?.filter((r) => r.runId).map((r, i) => (
              <a key={r.runId} href={`https://agent.tinyfish.ai/runs/${encodeURIComponent(r.runId)}`} target="_blank" rel="noreferrer">
                {i ? ", " : ""}TinyFish run {r.batch + 1}{r.attempt > 1 ? " (retry)" : ""}
              </a>
            ))}
          </p>
        </div>
      )}
    </section>
  );
}
