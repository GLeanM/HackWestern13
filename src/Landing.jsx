import { Button, Icon, Logo } from "./ui.jsx";

export default function Landing({ onLogin, onSignup, error }) {
  return (
    <div className="landing">
      <header className="landing-bar">
        <Logo />
        <Button variant="ghost" onClick={onLogin}>Log in</Button>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><Icon name="spark" size={14} /> AI grocery shopping for T&amp;T Supermarket</span>
          <h1>Your grocery cart, <span>built for you.</span></h1>
          <p>
            Tell Autocart your budget and what you like to eat. It plans the week, prices every item at T&amp;T,
            and an agent fills your real T&amp;T cart. You just check out.
          </p>
          {error && <p className="field-error">Error: {error.message}</p>}
          <div className="hero-actions">
            <Button className="btn-lg" onClick={onSignup}>Get started free</Button>
            <Button variant="secondary" className="btn-lg" onClick={onLogin}>I have an account</Button>
          </div>
        </div>
        <div className="hero-card" aria-hidden="true">
          <div className="mock-row head"><span>Your cart</span><span className="mock-total">$47.89</span></div>
          {[["Green Onion", "2 × $0.75"], ["Firm Tofu", "3 × $1.97"], ["Chicken Thigh", "2.5 lb"], ["Gai Lan", "~1.5 lb"]].map(([n, q]) => (
            <div key={n} className="mock-row"><span className="mock-thumb" /><span>{n}</span><span className="muted">{q}</span></div>
          ))}
          <div className="mock-agent"><span className="pulse" /> Agent: Add Firm Tofu to cart</div>
        </div>
      </section>

      <section className="features">
        {[
          ["spark", "Plans your meals", "A week of meals around your budget, diet and pantry, as one short shopping list."],
          ["store", "Prices at T&T", "Every item matched to a real T&T product, priced and checked against your budget."],
          ["cart", "Fills your cart", "Approve once, watch the agent add everything to your T&T cart, and stop it any time."],
        ].map(([icon, title, text]) => (
          <article key={title} className="feature">
            <span className="feature-icon"><Icon name={icon} size={20} /></span>
            <h3>{title}</h3>
            <p className="muted">{text}</p>
          </article>
        ))}
      </section>

      <footer className="landing-foot muted small">
        Not affiliated with T&amp;T Supermarket. Autocart never places orders or pays for you.
      </footer>
    </div>
  );
}
