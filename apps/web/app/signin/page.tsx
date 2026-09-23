import { adminSignIn, subscriberSignIn } from "./actions";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const { error, sent } = await searchParams;
  return (
    <section className="auth-page" aria-labelledby="auth-page-title">
      <div className="auth-card">
        <div className="auth-card-body">
          <div className="auth-benefits">
            <span className="auth-kicker">HighOdds research</span>
            <h1>Football analysis with <em>the evidence left visible.</em></h1>
            <p>Paper tickets recorded before kickoff, with losses shown alongside wins. Payments and subscriptions are not active during paper validation.</p>
            <div className="auth-benefit-list">
              <span><b>01</b> Daily published research</span>
              <span><b>02</b> Placeable single-bookmaker tickets</span>
              <span><b>03</b> Immutable, reviewable history</span>
            </div>
          </div>
          <div className="auth-form-panel">
            <a className="auth-card-brand" href="/" aria-label="HighOdds home">
              <span className="brand-mark" aria-hidden="true">H</span>
              <small>Evidence-led paper analysis</small>
            </a>
            <h2 id="auth-page-title">Sign in to HighOdds</h2>
            <p>Subscribers receive an email magic link after an administrator has activated access.</p>
            {sent === "1" && <div className="notice" role="status">Check your email for a sign-in link.</div>}
            {error === "email-send-failed" && <div className="notice" role="alert">Couldn&apos;t send the sign-in email. Try again shortly.</div>}
            <form action={subscriberSignIn}>
              <label>Email<input type="email" name="email" required autoComplete="email" /></label>
              <button type="submit" className="btn-primary">Email me a sign-in link</button>
            </form>

            <details className="auth-admin" open={error === "invalid-credentials"}>
              <summary>Admin sign in</summary>
              {error === "invalid-credentials" && <div className="notice" role="alert">Incorrect email or password.</div>}
              <form action={adminSignIn}>
                <label>Email<input type="email" name="email" required autoComplete="email" /></label>
                <label>Password<input type="password" name="password" required autoComplete="current-password" /></label>
                <button type="submit" className="btn-primary">Sign in as admin</button>
              </form>
            </details>
            <a className="auth-back" href="/">← Back to overview</a>
          </div>
        </div>
      </div>
    </section>
  );
}
