// Small shared UI kit for Autocart: icons, buttons, cards, chips, skeletons,
// and the budget meter. Styling lives in styles.css (tokens on :root).

const paths = {
  cart: "M3 4h2l2.4 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.4L21 8H6.2 M10 20a1 1 0 1 0 0 .01 M17 20a1 1 0 1 0 0 .01",
  check: "M5 12.5l4.5 4.5L19 7.5",
  lock: "M7 11V8a5 5 0 0 1 10 0v3 M6 11h12v9H6z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0",
  leaf: "M5 19c8 0 14-6 14-14-8 0-14 6-14 14z M5 19l7-7",
  list: "M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01",
  spark: "M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6 6l2.5 2.5 M15.5 15.5L18 18 M6 18l2.5-2.5 M15.5 8.5L18 6",
  stop: "M7 7h10v10H7z",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7 M20 5v6h-6",
  external: "M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3 M10 16l-4-4 4-4 M6 12h10",
  store: "M4 9l1.5-5h13L20 9 M4 9v11h16V9 M4 9h16 M9 20v-6h6v6",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z M8.5 12l2.5 2.5 4.5-5",
  chevron: "M9 6l6 6-6 6",
  info: "M12 11v6 M12 7.5h.01 M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2",
  alert: "M12 8v5 M12 16.5h.01 M10.3 3.9L2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
};

export function Icon({ name, size = 18, className = "" }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

export function Logo({ compact = false }) {
  return (
    <span className="logo">
      <svg className="logo-mark" width="18" height="22" viewBox="0 0 18 22" aria-hidden="true">
        <path d="M0 0h18v22l-3-2-3 2-3-2-3 2-3-2-3 2z" fill="currentColor" />
        <path d="M4 6h10M4 10h10M4 14h6" stroke="var(--surface)" strokeWidth="1.6" />
      </svg>
      {!compact && <span className="logo-word">autocart</span>}
    </span>
  );
}

export function Button({ variant = "primary", icon, children, className = "", ...props }) {
  return (
    <button type="button" className={`btn btn-${variant} ${className}`} {...props}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

export function Card({ title, subtitle, actions, children, className = "", ...props }) {
  return (
    <section className={`card ${className}`} {...props}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Chip({ tone = "neutral", children, icon }) {
  return (
    <span className={`chip chip-${tone}`}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

export function Spinner({ label }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function Skeleton({ width = "100%", height = 14, className = "" }) {
  return <span className={`skeleton ${className}`} style={{ width, height }} aria-hidden="true" />;
}

const money = (x) => `$${(x ?? 0).toFixed(2)}`;

export function BudgetMeter({ total, budget, compact = false }) {
  const pct = budget ? Math.min(100, (total / budget) * 100) : 0;
  const over = total > budget;
  return (
    <div className={`budget ${over ? "over" : ""} ${compact ? "compact" : ""}`}>
      <div className="budget-nums">
        <strong>{money(total)}</strong>
        <span>{over ? `${money(total - budget)} over` : `${money(budget - total)} left`} of {money(budget)}</span>
      </div>
      <div className="budget-bar" role="meter" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={total} aria-label="Cart total against budget">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Notice({ tone = "info", children }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "danger" ? "alert" : undefined}>
      <Icon name={tone === "danger" || tone === "warning" ? "alert" : "info"} size={16} />
      <div>{children}</div>
    </div>
  );
}

export { money };
