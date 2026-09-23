import Link from "next/link";
import { db } from "@highodds/db";

export const dynamic = "force-dynamic";

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const dateTime = (value: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Blantyre", dateStyle: "medium", timeStyle: "short" }).format(value);

export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ fixture?: string }> }) {
  const { fixture: fixtureId } = await searchParams;
  const now = new Date();
  const fixtures = await db.fixture.findMany({
    where: { kickoff: { gte: new Date(now.getTime() - 12 * 60 * 60 * 1000) }, predictions: { some: {} } },
    orderBy: { kickoff: "asc" }, take: 80,
    include: { competition: true, homeTeam: true, awayTeam: true, predictions: { orderBy: { asOfAt: "desc" }, include: { market: true, modelRun: true } }, quotes: { orderBy: { capturedAt: "desc" }, take: 100, include: { bookmaker: true, market: true } } }
  });
  const selected = fixtures.find((fixture) => fixture.id === fixtureId) ?? fixtures[0];
  const probabilityGroups = selected?.predictions.reduce((groups, prediction) => {
    const key = prediction.market.normalizedKey ?? prediction.market.name;
    const rows = groups.get(key) ?? [];
    if (!rows.some((row) => row.selection === prediction.selection)) rows.push(prediction);
    groups.set(key, rows);
    return groups;
  }, new Map<string, typeof selected.predictions>());

  return <section>
    <p className="eyebrow">FIXTURE RESEARCH</p>
    <h1>Research workspace</h1>
    <p>Model probabilities and locally captured pre-kickoff prices. A displayed probability is a model estimate, not a validated edge or betting recommendation.</p>
    {fixtures.length === 0 ? <div className="notice">No scored fixtures are available yet. Predictions appear after the model and evidence gates pass.</div> : <div className="research-layout">
      <nav className="research-fixtures" aria-label="Scored fixtures">
        {fixtures.map((fixture) => <Link key={fixture.id} href={`/research?fixture=${fixture.id}`} className={`research-fixture${fixture.id === selected?.id ? " active" : ""}`}>
          <small>{dateTime(fixture.kickoff)} · {fixture.competition.name}</small><strong>{fixture.homeTeam.name} <span>vs</span> {fixture.awayTeam.name}</strong><small>{fixture.status}</small>
        </Link>)}
      </nav>
      {selected && <article className="research-detail">
        <p className="eyebrow">{selected.competition.name} · {dateTime(selected.kickoff)}</p>
        <h2>{selected.homeTeam.name} vs {selected.awayTeam.name}</h2>
        <p className="meta">Fixture status: {selected.status}{selected.statusCode ? ` (${selected.statusCode})` : ""}. Model run and prediction timestamps are shown below.</p>
        <h3>Model probabilities</h3>
        <div className="research-probabilities">{Array.from(probabilityGroups?.entries() ?? []).map(([market, rows]) => <div className="research-market" key={market}>
          <strong>{market.replaceAll("_", " ")}</strong>
          <div>{rows.map((row) => <span key={`${row.modelRunId}-${row.selection}`}><b>{row.selection.replaceAll("_", " ")}</b>{pct(Number(row.probability))}</span>)}</div>
          <small>{rows[0] ? `${rows[0].modelRun.method} · trained through ${dateTime(rows[0].modelRun.trainedUntil)} · forecast ${dateTime(rows[0].asOfAt)}` : ""}</small>
        </div>)}</div>
        <h3>Captured prices</h3>
        <p className="meta">Quotes are grouped by market and selection. Each record was captured before kickoff; this feed may be incomplete between provider snapshots.</p>
        {selected.quotes.length === 0 ? <p>No locally captured prices for this fixture.</p> : <div className="matches-table-wrap"><table className="matches-table"><thead><tr><th>Market</th><th>Selection</th><th>Bookmaker</th><th>Odds</th><th>Movement</th><th>Captured</th><th>Provider update</th></tr></thead><tbody>{selected.quotes.map((quote, index) => {
          const older = selected.quotes.slice(index + 1).find((candidate) => candidate.bookmakerId === quote.bookmakerId && candidate.marketId === quote.marketId && candidate.selection === quote.selection);
          const change = older ? (Number(quote.decimalOdds) - Number(older.decimalOdds)) / Number(older.decimalOdds) * 100 : null;
          return <tr key={quote.id}><td>{quote.market.normalizedKey ?? quote.market.name}</td><td>{quote.selection}</td><td>{quote.bookmaker.name}</td><td>{Number(quote.decimalOdds).toFixed(2)}</td><td>{change === null ? "First capture" : `${change > 0 ? "+" : ""}${change.toFixed(1)}% vs previous`}</td><td>{dateTime(quote.capturedAt)}</td><td>{quote.providerUpdatedAt ? dateTime(quote.providerUpdatedAt) : "Not supplied"}</td></tr>;
        })}</tbody></table></div>}
      </article>}
    </div>}
  </section>;
}
