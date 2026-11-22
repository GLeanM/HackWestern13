const OUTCOME = {
  pending: { label: "Working…", cls: "chip-muted" },
  added: { label: "Added", cls: "chip-ok" },
  updated: { label: "Quantity set", cls: "chip-ok" },
  out_of_stock: { label: "Out of stock", cls: "chip-bad" },
  unavailable: { label: "Unavailable", cls: "chip-bad" },
  failed: { label: "Failed", cls: "chip-bad" },
};
const STATUS_TEXT = {
  building: "The agent is adding your items to T&T…",
  built: "Your T&T cart is ready.",
  partial: "Most items are in your T&T cart. Check the ones below.",
  failed: "The agent couldn't add your items.",
};
const T_AND_T_HOME = "https://www.tntsupermarket.com/eng/";

export default function CartBuild({ cartRun, building }) {
  if (!cartRun) return null;
  const live = cartRun.runs?.filter((r) => r.status !== "COMPLETED" && r.status !== "FAILED" && r.status !== "CANCELLED") ?? [];
  const status = building ? "building" : cartRun.status;

  return (
    <section className="cart-build" aria-live="polite">
      <h3>{STATUS_TEXT[status] ?? "Cart build"}</h3>

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
                Agent {r.batch + 1} · {r.status.toLowerCase()}{r.steps ? ` · ${r.steps} steps` : ""}
              </span>
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
              {cartRun.counts.failed ? ` · ${cartRun.counts.failed} failed` : ""}
              {cartRun.cartSubtotal && <> · cart subtotal (as read by the agent) <strong>{cartRun.cartSubtotal}</strong></>}
            </p>
          )}
          <div className="actions">
            <a className="button" href={cartRun.cartUrl ?? T_AND_T_HOME} target="_blank" rel="noreferrer">Open my T&amp;T cart</a>
            <span className="muted">Choose delivery or pickup and check out on T&amp;T yourself. CartPilot never pays.</span>
          </div>
          <p className="muted small">
            Your T&amp;T cart also keeps anything that was already in it. T&amp;T shows the final subtotal once you pick delivery or pickup.
          </p>
          <p className="muted small">
            Approved {new Date(cartRun.approval.approvedAt).toLocaleString()} with the build:cart permission.{" "}
            {cartRun.runs?.filter((r) => r.runId).map((r, i) => (
              <a key={r.runId} href={`https://agent.tinyfish.ai/runs/${encodeURIComponent(r.runId)}`} target="_blank" rel="noreferrer">
                {i ? ", " : ""}TinyFish run {r.batch + 1}
              </a>
            ))}
          </p>
        </div>
      )}
    </section>
  );
}
