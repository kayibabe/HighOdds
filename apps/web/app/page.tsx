export default function Home() {
  return <section className="home-page">
    <div className="hero">
      <p className="eyebrow">PAPER VALIDATION</p>
      <h1>Decide with the evidence in view.</h1>
      <p>HighOdds records pre-kickoff prices, tests forecasts against results, and keeps losses visible. It is a research workspace—not a betting service or a guarantee.</p>
      <div className="hero-actions"><a className="btn-primary" href="/research">Explore research</a><a className="btn-secondary" href="/results">Review results</a></div>
    </div>
    <div className="home-principles" aria-labelledby="principles-title">
      <div className="section-heading"><div><p className="eyebrow">HOW TO USE IT</p><h2 id="principles-title">Three screens, three jobs</h2></div><p className="meta">Start with the question you need answered.</p></div>
      <div className="grid">
        <article><span className="principle-index">01</span><h3>Today</h3><p>See published paper tickets and the current fixture slate.</p><a href="/dashboard">Open today</a></article>
        <article><span className="principle-index">02</span><h3>Research</h3><p>Inspect one fixture’s probability, captured price, and result evidence.</p><a href="/research">Inspect fixtures</a></article>
        <article><span className="principle-index">03</span><h3>Results</h3><p>Check settled history and whether the model has earned trust over time.</p><a href="/results">Review results</a></article>
      </div>
    </div>
    <details className="home-method"><summary>How evidence moves through HighOdds</summary><div className="flow-steps"><article><span>01</span><h3>Capture</h3><p>Fixtures and bookmaker prices are stored with their received and captured times.</p></article><article><span>02</span><h3>Forecast</h3><p>Walk-forward probabilities are tied to a training cutoff and forecast time.</p></article><article><span>03</span><h3>Publish &amp; settle</h3><p>Only fresh selections are published; results, voids, ROI, and model quality remain reviewable.</p></article></div></details>
  </section>;
}
