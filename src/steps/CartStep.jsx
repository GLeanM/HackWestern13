import ReviewCart from "../ReviewCart.jsx";
import { Button, Card, Chip, Notice, Skeleton } from "../ui.jsx";

const fmtQty = (qs) => qs.map((q) => (q.unit === "count" ? `${q.amount}` : `${q.amount} ${q.unit}`)).join(" + ");
const fmtCategory = (c) => c.replace(/-/g, " & ");
const groupBy = (xs, key) => xs.reduce((acc, x) => ((acc[key(x)] ??= []).push(x), acc), {});

export default function CartStep({ task, setTask, api, refreshPrices, error, goTo }) {
  const researching = task.status === "researching";
  const building = task.status === "building";
  const research = task.result.research;
  const toBuy = task.result.toBuy ?? [];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Your cart</h1>
          <p className="muted">
            {researching
              ? "Your list is ready. TinyFish is finding each item at T&T…"
              : "Swap products, change pack counts, or remove what you don't need. Nothing goes to T&T until you approve."}
          </p>
        </div>
        <div className="page-actions">
          {!researching && research && (
            <Button variant="ghost" icon="refresh" onClick={refreshPrices} disabled={building}>Refresh prices</Button>
          )}
          {task.status === "planned" && !research && (
            <Button onClick={refreshPrices}>Find prices on T&amp;T</Button>
          )}
        </div>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {task.error && !researching && <Notice tone="warning">{task.error}</Notice>}

      {researching && !research ? (
        <PricingList toBuy={toBuy} />
      ) : research ? (
        <>
          {researching && <Notice>Refreshing T&amp;T prices… your edits are kept where possible.</Notice>}
          <ReviewCart task={task} setTask={setTask} api={api} stale={researching || building} />
          {task.status === "priced" && (
            <div className="next-row">
              <Button icon="cart" onClick={() => goTo("build")}>Continue to build cart</Button>
            </div>
          )}
        </>
      ) : (
        <PricingList toBuy={toBuy} idle />
      )}
    </div>
  );
}

/** The shopping list straight after planning, with price slots filling in. */
function PricingList({ toBuy, idle = false }) {
  const byCategory = groupBy(toBuy, (i) => i.category);
  return (
    <Card>
      {Object.entries(byCategory).map(([cat, items]) => (
        <div key={cat} className="list-group">
          <h3 className="group-title">{fmtCategory(cat)}</h3>
          <ul className="price-list">
            {items.map((i) => (
              <li key={i.name} className="price-item pending">
                <div className="product">
                  <span className="img-placeholder skeleton" aria-hidden="true" />
                  <div>
                    <div className="item-name">{i.name}</div>
                    <div className="muted small">{fmtQty(i.quantities)} · used in {i.usedIn.length} meal{i.usedIn.length === 1 ? "" : "s"}</div>
                  </div>
                </div>
                <div className="line-cost">
                  {idle ? <Chip>Not priced yet</Chip> : (
                    <>
                      <Skeleton width={64} height={16} />
                      <span className="muted small">Finding T&amp;T price…</span>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  );
}
