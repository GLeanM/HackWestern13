import { useState } from "react";

const money = (x) => `$${x.toFixed(2)}`;

/**
 * The consequential step. Asks Auth0 for the build:cart permission only now,
 * and sends back the exact total and item count the user is looking at so the
 * server can refuse if the cart changed underneath them.
 */
export default function ApproveCart({ task, setTask, api, reload }) {
  const review = task.review;
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rebuild = task.status === "built";
  if (!review || review.readyForAgent === 0) return null;

  async function approve() {
    setBusy(true);
    setError("");
    try {
      const { task: t } = await api(`/shopping-tasks/${task.id}/build-cart`, {
        method: "POST",
        scope: "build:cart",
        body: { expectedTotal: review.total, expectedItems: review.itemCount },
      });
      setTask(t);
      reload(t.id);
    } catch (err) {
      if (err.body?.error === "stale_review") reload(task.id);
      setError(
        err.error === "access_denied" || err.status === 403
          ? "Autocart needs your permission to build the cart. Approve again and allow access."
          : err.message === "Popup closed" || err.error === "cancelled"
            ? "The permission window was closed. Approve again when you're ready."
            : err.body?.message ?? "Couldn't start building your cart.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="approve card" aria-labelledby="approve-h">
      <h3 id="approve-h">{rebuild ? "Rebuild your T&T cart" : "Approve & build your T&T cart"}</h3>
      <p>
        Autocart's agent will add <strong>{review.readyForAgent} item{review.readyForAgent === 1 ? "" : "s"}</strong>{" "}
        (about <strong>{money(review.total)}</strong>) to your T&amp;T cart, setting each to the quantity you chose.
        {rebuild && " Items already in your cart are set to these quantities, not added again."}
      </p>
      <label className="agree">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>I approve. The agent will <strong>not</strong> check out or pay. I'll finish checkout on T&amp;T myself.</span>
      </label>
      <div className="actions">
        <button type="button" className="btn btn-primary btn-lg" disabled={!agreed || busy} onClick={approve}>
          {busy ? "Starting the agent…" : rebuild ? "Rebuild cart" : "Approve & build cart"}
        </button>
        <span className="muted">You'll be asked to grant Autocart the "build cart" permission.</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
