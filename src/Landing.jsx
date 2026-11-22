import { Button, Logo } from "./ui.jsx";

const RECEIPT = [
  ["Green onion", "2", 1.5],
  ["Firm tofu 454g", "3", 5.91],
  ["Chicken thigh, bnls", "2.5lb", 14.98],
  ["Baby bok choy", "1", 3.49],
  ["Napa kimchi 500g", "1", 6.99],
  ["Large eggs, dozen", "1", 4.29],
];
const BUDGET = 60;

const STEPS = [
  ["Tell it your budget and how you eat", "Household size, how many days, diet, allergies, and what's already in the pantry."],
  ["It plans the meals and prices the list", "Each ingredient is matched to a real T&T product and priced. You can swap, change pack counts or drop anything."],
  ["You approve and an agent fills your cart", "A browser agent adds each item to your T&T cart while you watch. You check out on T&T yourself."],
];

export default function Landing({ onLogin, onSignup, error }) {
  const subtotal = RECEIPT.reduce((s, [, , p]) => s + p, 0);
  return (
    <div className="landing">
      <header className="landing-bar">
        <Logo />
        <button type="button" className="link-btn" onClick={onLogin}>Log in</button>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <h1>Groceries for the week, priced at T&amp;T and put in your cart.</h1>
          <p>
            Set a budget. Autocart plans the meals, finds every ingredient at T&amp;T Supermarket,
            and adds it all to your cart. Checking out is still up to you.
          </p>
          {error && <p className="field-error">Error: {error.message}</p>}
          <div className="hero-actions">
            <Button className="btn-lg" onClick={onSignup}>Sign up</Button>
            <span className="muted">or <button type="button" className="link-btn" onClick={onLogin}>log in</button></span>
          </div>
        </div>

        <figure className="receipt" aria-hidden="true">
          <div className="receipt-head">
            <strong>T&amp;T SUPERMARKET</strong>
            <span>LONDON N6G · 3 DAYS · 1 PERSON</span>
          </div>
          <ul className="receipt-lines">
            {RECEIPT.map(([name, qty, price]) => (
              <li key={name}>
                <span className="r-qty">{qty}</span>
                <span className="r-name">{name}</span>
                <span className="r-price">{price.toFixed(2)}</span>
              </li>
            ))}
          </ul>
          <dl className="receipt-totals">
            <div><dt>SUBTOTAL</dt><dd>{subtotal.toFixed(2)}</dd></div>
            <div><dt>BUDGET</dt><dd>{BUDGET.toFixed(2)}</dd></div>
            <div className="r-left"><dt>LEFT</dt><dd>{(BUDGET - subtotal).toFixed(2)}</dd></div>
          </dl>
          <p className="receipt-log">&gt; agent: adding firm tofu (3)<span className="caret" /></p>
        </figure>
      </section>

      <section className="how" aria-labelledby="how-h">
        <h2 id="how-h">How it works</h2>
        <ol>
          {STEPS.map(([title, text], i) => (
            <li key={title}>
              <span className="how-num">{String(i + 1).padStart(2, "0")}</span>
              <h3>{title}</h3>
              <p className="muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="landing-foot muted small">
        Not affiliated with T&amp;T Supermarket. Autocart never places orders or pays for you.
      </footer>
    </div>
  );
}
