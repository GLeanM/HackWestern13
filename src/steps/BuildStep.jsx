import ApproveCart from "../ApproveCart.jsx";
import CartBuild from "../CartBuild.jsx";
import { Icon, Notice } from "../ui.jsx";

/** Approve, watch the agent work live, and see what landed in the T&T cart. */
export default function BuildStep({ task, setTask, api, reload, goTo }) {
  const building = task.status === "building";
  const built = task.status === "built";
  const canApprove = task.status === "priced" || built;
  const cartRun = task.result?.cartRun;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Build cart</h1>
          <p className="muted">
            {building
              ? "Autocart's agent is shopping on T&T for you. Watch it live below."
              : built
                ? "Your T&T cart is ready. Check out on T&T whenever you like."
                : "Approve once and Autocart's agent fills your real T&T cart. It never checks out or pays."}
          </p>
        </div>
      </div>

      {!canApprove && !building && (
        <Notice>
          Finish your cart first.{" "}
          <button type="button" className="link-btn" onClick={() => goTo("cart")}>Go to cart</button>
        </Notice>
      )}

      {task.error && !building && <Notice tone="warning">{task.error}</Notice>}

      {(building || built) && cartRun && (
        <CartBuild cartRun={cartRun} building={building} taskId={task.id} api={api} onUpdate={setTask} />
      )}

      {canApprove && !building && (
        <ApproveCart key={task.status} task={task} setTask={setTask} api={api} reload={reload} />
      )}

      <ul className="trust-row">
        <li><Icon name="shield" size={16} /> Agent access needs your one-time <strong>build cart</strong> permission</li>
        <li><Icon name="stop" size={16} /> Stop the agent any time</li>
        <li><Icon name="store" size={16} /> You check out on T&amp;T yourself</li>
      </ul>
    </div>
  );
}
