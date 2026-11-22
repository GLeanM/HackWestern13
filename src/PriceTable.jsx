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
  "no-link": "Couldn't get a product link, so the agent can't add this automatically.",
};

function sizeLabel(p) {
  if (!p.size) return "";
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
          {money(p.price)}{p.perLb ? "/lb" : ""}
          {p.wasPrice != null && <s> {money(p.wasPrice)}{p.perLb ? "/lb" : ""}</s>}
          {p.discountPct != null && <span className="badge-sale">-{p.discountPct}%</span>}
          {p.unitPrice && <> · {money(p.unitPrice.value)}/{p.unitPrice.per}</>}
          {p.note && <> · {p.note}</>}
        </div>
      </div>
    </div>
  );
}

export default function PriceTable({ research, stale }) {
  const pct = Math.min(100, (research.total / research.budget) * 100);
  return (
    <div className={`prices${stale ? " stale" : ""}`}>
      <div className="total-row">
        <div>
          <strong>Estimated total {money(research.total)}</strong>
          <span className="muted"> of your {money(research.budget)} budget</span>
        </div>
        <span className="muted">
          {research.counts.matched} matched · {research.counts.uncertain} to check · {research.counts.notFound} not found
        </span>
      </div>
      <div className={`budget-bar${research.overBudget ? " over" : ""}`} role="meter" aria-valuemin={0}
        aria-valuemax={research.budget} aria-valuenow={research.total} aria-label="Total against budget">
        <span style={{ width: `${pct}%` }} />
      </div>

      {research.warnings.length > 0 && (
        <ul className="warnings">
          {research.warnings.map((w, i) => <li key={i} className={`warn-${w.type}`}>{w.message}</li>)}
        </ul>
      )}

      <ul className="price-list">
        {research.items.map((it) => (
          <li key={it.name} className="price-item">
            <div className="price-head">
              <span className="item-name">{it.name}</span>
              <span className={`chip ${STATUS[it.status].cls}`}>{STATUS[it.status].label}</span>
            </div>
            {it.chosen ? (
              <div className="price-body">
                <ProductLine p={it.chosen} />
                <div className="line-cost">
                  <span className="muted">{it.chosen.packages} × {sizeLabel(it.chosen)}</span>
                  <strong>{money(it.chosen.cost)}</strong>
                </div>
              </div>
            ) : (
              <p className="muted">No match for “{it.query}” on T&amp;T{it.error ? " (search failed)" : ""}.</p>
            )}
            {it.chosen?.flags?.length > 0 && (
              <ul className="flags">
                {it.chosen.flags.map((f) => <li key={f}>{FLAG_TEXT[f] ?? f}</li>)}
              </ul>
            )}
            {it.alternatives?.length > 0 && (
              <details className="alts">
                <summary>{it.alternatives.length} other option{it.alternatives.length > 1 ? "s" : ""}</summary>
                {it.alternatives.map((a) => (
                  <div key={a.name} className="alt">
                    <ProductLine p={a} />
                    <span className="muted">{a.packages} × = {money(a.cost)}</span>
                  </div>
                ))}
              </details>
            )}
          </li>
        ))}
      </ul>
      <p className="muted small">
        Prices retrieved {fmtTime(research.retrievedAt)} by TinyFish. {research.storeNote}
      </p>
    </div>
  );
}
