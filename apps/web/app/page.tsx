export default function Home() {
  return <section className="hero">
    <p className="eyebrow">PAPER-VALIDATION PLATFORM</p>
    <h1>Football analysis with the evidence left visible.</h1>
    <p>HighOdds records prices before kickoff, tests model forecasts against results, and keeps losses alongside wins. It does not place bets or guarantee outcomes.</p>
    <div className="hero-actions"><a className="btn-primary" href="/dashboard">Open today&apos;s research</a><a className="btn-secondary" href="/research">Browse fixtures</a></div>
    <div className="notice"><strong>Paper-only by design.</strong> Current tickets are private while the 90-day evidence ledger is being built.</div>
    <section className="flow-panel" aria-labelledby="evidence-flow-title">
      <div><p className="eyebrow">THE EVIDENCE FLOW</p><h2 id="evidence-flow-title">From source data to reviewable result</h2></div>
      <div className="flow-steps">
        <article><span>01</span><h3>Capture</h3><p>Fixtures and bookmaker prices are stored with their received and captured times.</p></article>
        <article><span>02</span><h3>Forecast</h3><p>Walk-forward model probabilities are tied to a training cutoff and forecast time.</p></article>
        <article><span>03</span><h3>Publish</h3><p>Only fresh, data-qualified selections can appear on a single-bookmaker paper ticket.</p></article>
        <article><span>04</span><h3>Settle</h3><p>Recorded results, voids, ROI, CLV, and model quality stay visible for review.</p></article>
      </div>
    </section>
    <div className="grid"><article><h2>1.80+ legs</h2><p>Only fresh, data-qualified selections with conservative positive expected value.</p></article><article><h2>Placeable tickets</h2><p>Every accumulator uses a single configured bookmaker and one leg per fixture.</p></article><article><h2>Immutable history</h2><p>Published versions and source odds are retained for independent review.</p></article></div>
  </section>;
}
