import Link from "next/link";
import { db } from "@highodds/db";
import { blantyreDayBounds, blantyreToday, displayLegOutcome, parseIsoDay, parseSettlementEvidence, resolveSelection } from "@highodds/core";
import { DayNav, formatDay } from "../date-nav";

export const dynamic = "force-dynamic";

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const dateTime = (value: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Blantyre", dateStyle: "medium", timeStyle: "short" }).format(value);
const label = (value: string) => value.replaceAll("_", " ");
const score = (fixture: { homeGoals: number | null; awayGoals: number | null }) => fixture.homeGoals !== null && fixture.awayGoals !== null ? `${fixture.homeGoals}–${fixture.awayGoals}` : null;
const LEG_OUTCOME_LABEL: Record<string, string> = { WIN: "Won", LOSS: "Lost", VOID: "Void", PENDING: "Pending", UNRESOLVED: "Unresolved" };
const SCREEN_MARKETS = ["TOTAL_GOALS", "MATCH_WINNER", "BTTS"] as const;
const SCREEN_SELECTIONS = ["UNDER_2_5", "OVER_2_5", "HOME", "DRAW", "AWAY", "YES", "NO"] as const;

const fixtureInclude = {
  competition: true, homeTeam: true, awayTeam: true,
  predictions: { orderBy: { asOfAt: "desc" as const }, include: { market: true, modelRun: true } },
  quotes: { orderBy: { capturedAt: "desc" as const }, take: 100, include: { bookmaker: true, market: true } }
};

function resultHeadline(fixture: { status: string; statusCode: string | null; elapsedMinute: number | null; homeGoals: number | null; awayGoals: number | null }): string {
  const line = score(fixture);
  if (fixture.status === "FINISHED") return line ? `Full time · ${line}` : "Finished · score not recorded";
  if (fixture.status === "LIVE") return `In play${fixture.elapsedMinute === null ? "" : ` · ${fixture.elapsedMinute}′`}${line ? ` · ${line}` : ""}`;
  if (fixture.status === "POSTPONED") return "Postponed · markets void";
  if (fixture.status === "CANCELLED") return "Cancelled · markets void";
  return "Not started";
}

function numberParam(value: string | string[] | undefined, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanScreenValue(value: string | string[] | undefined, allowed: readonly string[], fallback: string): string {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

export default async function ResearchPage({ searchParams }: { searchParams: Promise<{
  fixture?: string | string[]; date?: string | string[]; screen?: string | string[]; market?: string | string[];
  selection?: string | string[]; minProbability?: string | string[]; minOdds?: string | string[]; maxQuoteAge?: string | string[];
}> }) {
  const params = await searchParams;
  const { fixture: fixtureParam, date } = params;
  const fixtureId = typeof fixtureParam === "string" ? fixtureParam : undefined;
  const screening = params.screen === "1";
  const screenMarket = cleanScreenValue(params.market, SCREEN_MARKETS, "TOTAL_GOALS");
  const screenSelection = cleanScreenValue(params.selection, SCREEN_SELECTIONS, "UNDER_2_5");
  const minProbability = Math.min(1, Math.max(0, numberParam(params.minProbability, 60) / 100));
  const minOdds = Math.max(1, numberParam(params.minOdds, 1.8));
  const maxQuoteAge = Math.max(0, numberParam(params.maxQuoteAge, 0));
  const now = new Date();
  const today = blantyreToday(now);
  const day = parseIsoDay(date);

  // Without a date: the upcoming slate (as before). With a date: every researched fixture that day,
  // including ones that only appear on tickets, so past results stay reachable.
  const fixtures = await db.fixture.findMany({
    where: day
      ? { kickoff: { gte: blantyreDayBounds(day).start, lt: blantyreDayBounds(day).end }, OR: [{ predictions: { some: {} } }, { ticketLegs: { some: {} } }] }
      : { kickoff: { gte: new Date(now.getTime() - 12 * 60 * 60 * 1000) }, predictions: { some: {} } },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }], take: day ? 200 : 80,
    include: fixtureInclude
  });
  const selected = fixtures.find((fixture) => fixture.id === fixtureId)
    ?? (fixtureId ? await db.fixture.findUnique({ where: { id: fixtureId }, include: fixtureInclude }) : null)
    ?? fixtures[0];

  const screenCandidates = screening ? fixtures.flatMap((fixture) => {
    const prediction = fixture.predictions
      .filter((row) => (row.market.normalizedKey ?? row.market.name) === screenMarket && row.selection === screenSelection)
      .filter((row) => row.asOfAt < fixture.kickoff && row.modelRun.trainedUntil <= row.asOfAt)
      .sort((a, b) => b.asOfAt.getTime() - a.asOfAt.getTime())[0];
    const quotes = fixture.quotes
      .filter((quote) => quote.bookmaker.active && (quote.market.normalizedKey ?? quote.market.name) === screenMarket && quote.selection === screenSelection)
      .filter((quote) => quote.capturedAt < fixture.kickoff)
      .filter((quote) => maxQuoteAge === 0 || fixture.kickoff.getTime() - quote.capturedAt.getTime() <= maxQuoteAge * 60_000)
      .sort((a, b) => Number(b.decimalOdds) - Number(a.decimalOdds));
    const quote = quotes[0];
    if (!prediction || !quote || Number(prediction.probability) < minProbability || Number(quote.decimalOdds) < minOdds) return [];
    return [{ fixture, probability: Number(prediction.probability), odds: Number(quote.decimalOdds), bookmaker: quote.bookmaker.name, quoteCapturedAt: quote.capturedAt, predictionAsOfAt: prediction.asOfAt, trainedUntil: prediction.modelRun.trainedUntil }];
  }) : [];

  const selectedFixture = screening && !fixtureId ? screenCandidates[0]?.fixture : selected;

  const probabilityGroups = selectedFixture?.predictions.reduce((groups, prediction) => {
    const key = prediction.market.normalizedKey ?? prediction.market.name;
    const rows = groups.get(key) ?? [];
    if (!rows.some((row) => row.selection === prediction.selection)) rows.push(prediction);
    groups.set(key, rows);
    return groups;
  }, new Map<string, NonNullable<typeof selectedFixture>["predictions"]>());

  const finalScore = selectedFixture?.status === "FINISHED" && selectedFixture.homeGoals !== null && selectedFixture.awayGoals !== null
    ? { home: selectedFixture.homeGoals, away: selectedFixture.awayGoals } : null;
  const marketResults = Array.from(probabilityGroups?.entries() ?? []).map(([market, rows]) => {
    const outcomes = rows.map((row) => ({ row, hit: finalScore ? resolveSelection(market, row.selection, finalScore.home, finalScore.away) === "WIN" : null }));
    const pick = rows.reduce<(typeof rows)[number] | undefined>((best, row) => !best || Number(row.probability) > Number(best.probability) ? row : best, undefined);
    const resolvable = outcomes.every((item) => item.hit !== null) && outcomes.some((item) => item.hit);
    const brier = finalScore && resolvable ? outcomes.reduce((sum, item) => sum + (Number(item.row.probability) - Number(item.hit)) ** 2, 0) / outcomes.length : null;
    return { market, rows, outcomes, pick, pickHit: pick ? outcomes.find((item) => item.row === pick)?.hit ?? null : null, brier, winner: outcomes.find((item) => item.hit)?.row ?? null };
  });

  const ticketLegs = selectedFixture ? await db.ticketLeg.findMany({
    where: { fixtureId: selectedFixture.id, ticketVersion: { successors: { none: {} } } },
    include: { ticketVersion: { include: { settlements: true } } },
    orderBy: { ticketVersion: { tier: "asc" } }
  }) : [];

  const filterQuery = screening ? `&screen=1&market=${screenMarket}&selection=${screenSelection}&minProbability=${(minProbability * 100).toFixed(0)}&minOdds=${minOdds}${maxQuoteAge ? `&maxQuoteAge=${maxQuoteAge}` : ""}` : "";
  const listHref = (id: string) => `${day ? `/research?date=${day}` : "/research?fixture=" + id}${day ? `&fixture=${id}` : ""}${filterQuery}`;
  const screenHref = (overrides: Record<string, string> = {}) => {
    const values = { date: day ?? "", screen: "1", market: screenMarket, selection: screenSelection, minProbability: String(Math.round(minProbability * 100)), minOdds: String(minOdds), ...(maxQuoteAge ? { maxQuoteAge: String(maxQuoteAge) } : {}), ...overrides };
    return `/research?${new URLSearchParams(Object.entries(values).filter(([, value]) => value !== "")).toString()}`;
  };

  return <section>
    <p className="eyebrow">FIXTURE RESEARCH</p>
    <h1>Fixture research</h1>
    <p className="page-intro">Inspect one fixture from forecast to result: model probabilities, locally captured pre-kickoff prices, and the evidence used to score it. A probability is a model estimate, not a validated edge or betting recommendation.</p>
    <DayNav basePath="/research" day={day} today={today} allowFuture upcomingLabel="Upcoming" />
    <section className="research-screener" aria-labelledby="research-screener-title">
      <div><p className="eyebrow">RESEARCH SCREENER</p><h2 id="research-screener-title">Find evidence-matched candidates</h2><p className="meta">Filter stored pre-kickoff model forecasts and active-bookmaker quotes. Results are paper research candidates, not automatically published tickets.</p></div>
      <form className="research-filter-form" action="/research" method="get">
        {day && <input type="hidden" name="date" value={day} />}
        <input type="hidden" name="screen" value="1" />
        <label>Market<select name="market" defaultValue={screenMarket}><option value="TOTAL_GOALS">Total goals</option><option value="MATCH_WINNER">Match winner</option><option value="BTTS">Both teams score</option></select></label>
        <label>Selection<select name="selection" defaultValue={screenSelection}>{SCREEN_SELECTIONS.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
        <label>Min probability %<input name="minProbability" type="number" min="0" max="100" step="1" defaultValue={Math.round(minProbability * 100)} /></label>
        <label>Min captured odds<input name="minOdds" type="number" min="1.01" max="1000" step="0.01" defaultValue={minOdds.toFixed(2)} /></label>
        <label>Max quote age at kickoff (min)<input name="maxQuoteAge" type="number" min="0" step="30" placeholder="Any" defaultValue={maxQuoteAge || ""} /></label>
        <button className="date-go" type="submit">Find candidates</button>
      </form>
      <div className="research-presets"><span>Quick filters:</span><Link href={screenHref({ minProbability: "60", minOdds: "1.8" })}>Under 2.5 · ≥60% · ≥1.80</Link><Link href={screenHref({ minProbability: "60", minOdds: "2.1" })}>Under 2.5 · ≥60% · ≥2.10</Link></div>
    </section>
    {screening && <section className="research-candidates" aria-labelledby="research-candidates-title"><div className="section-heading"><div><p className="eyebrow">{screenCandidates.length} MATCH{screenCandidates.length === 1 ? "" : "ES"} FOUND</p><h2 id="research-candidates-title">{label(screenSelection)} candidates</h2></div><p className="meta">{label(screenMarket)} · probability ≥ {pct(minProbability)} · odds ≥ {minOdds.toFixed(2)}{maxQuoteAge ? ` · quote age ≤ ${maxQuoteAge} min` : ""}</p></div>{screenCandidates.length === 0 ? <div className="notice">No stored matches meet all filters for this date.</div> : <div className="matches-table-wrap"><table className="matches-table"><thead><tr><th>Match</th><th>Kickoff</th><th>Model probability</th><th>Captured odds</th><th>Bookmaker</th><th>Evidence</th></tr></thead><tbody>{screenCandidates.map((candidate) => <tr key={candidate.fixture.id}><th scope="row"><Link href={listHref(candidate.fixture.id)}>{candidate.fixture.homeTeam.name} vs {candidate.fixture.awayTeam.name}</Link><small>{candidate.fixture.competition.name}</small></th><td>{dateTime(candidate.fixture.kickoff)}</td><td className="num">{pct(candidate.probability)}</td><td className="num">{candidate.odds.toFixed(2)}</td><td>{candidate.bookmaker}</td><td><small>Forecast {dateTime(candidate.predictionAsOfAt)}<br />Quote {dateTime(candidate.quoteCapturedAt)}</small></td></tr>)}</tbody></table></div>}</section>}
    <p className="meta">{day ? `Fixtures on ${formatDay(day)} (Blantyre time) with a model forecast or a published ticket leg.` : "Upcoming and recently started fixtures with a model forecast. Pick a date to review past matches."}</p>
    {fixtures.length === 0 && !selectedFixture ? <div className="notice">{day ? `No researched fixtures on ${formatDay(day)}.` : "No scored fixtures are available yet. Predictions appear after the model and evidence gates pass."}</div> : <div className="research-layout">
      <nav className="research-fixtures" aria-label="Scored fixtures">
        {fixtures.length === 0 && <p className="meta">No other researched fixtures for this view.</p>}
        {fixtures.map((fixture) => <Link key={fixture.id} href={listHref(fixture.id)} className={`research-fixture${fixture.id === selectedFixture?.id ? " active" : ""}`}>
          <small>{dateTime(fixture.kickoff)} · {fixture.competition.name}</small><strong>{fixture.homeTeam.name} <span>vs</span> {fixture.awayTeam.name}</strong><small>{fixture.status}{score(fixture) ? ` · ${score(fixture)}` : ""}</small>
        </Link>)}
      </nav>
      {selectedFixture && <article className="research-detail">
        <p className="eyebrow">{selectedFixture.competition.name} · {dateTime(selectedFixture.kickoff)}</p>
        <h2>{selectedFixture.homeTeam.name} vs {selectedFixture.awayTeam.name}</h2>
        <p className="meta">Fixture status: {selectedFixture.status}{selectedFixture.statusCode ? ` (${selectedFixture.statusCode})` : ""}. Last received {dateTime(selectedFixture.receivedAt)}.</p>

        <section className="research-result" aria-labelledby="research-result-title">
          <h3 id="research-result-title">Match result</h3>
          <div className={`research-scoreboard status-${selectedFixture.status.toLowerCase()}`}>
            <span>{selectedFixture.homeTeam.name}</span>
            <strong>{score(selectedFixture) ?? "–"}</strong>
            <span>{selectedFixture.awayTeam.name}</span>
          </div>
          <p className="research-result-state">{resultHeadline(selectedFixture)}</p>
          {finalScore && marketResults.length > 0 && <div className="matches-table-wrap"><table className="matches-table">
            <thead><tr><th>Market</th><th>Result</th><th>Model pick</th><th>Model gave the result</th><th>Brier</th></tr></thead>
            <tbody>{marketResults.map((item) => <tr key={item.market}>
              <td>{label(item.market)}</td>
              <td>{item.winner ? label(item.winner.selection) : "Not resolvable"}</td>
              <td>{item.pick ? <>{label(item.pick.selection)} {item.pickHit === null ? null : <span className={`status-badge ${item.pickHit ? "win" : "loss"}`}>{item.pickHit ? "Hit" : "Miss"}</span>}</> : "—"}</td>
              <td>{item.winner ? pct(Number(item.winner.probability)) : "—"}</td>
              <td>{item.brier === null ? "—" : item.brier.toFixed(3)}</td>
            </tr>)}</tbody>
          </table></div>}
          {!finalScore && <p className="meta">{selectedFixture.status === "SCHEDULED" || selectedFixture.status === "LIVE" ? "Market results appear once the final score is stored." : "No final score is recorded; postponed and cancelled fixtures void every market."}</p>}
          {finalScore && <p className="meta">The model pick is the selection with the highest stored probability in each market. Brier is scored across that market&apos;s selections for this one match; lower is better and a single match is noisy.</p>}
        </section>

        {ticketLegs.length > 0 && <>
          <h3>On published tickets</h3>
          <div className="matches-table-wrap"><table className="matches-table">
            <thead><tr><th>Ticket</th><th>Selection</th><th>Odds</th><th>This leg</th><th>Ticket outcome</th></tr></thead>
            <tbody>{ticketLegs.map((leg) => {
              const settlement = leg.ticketVersion.settlements[0];
              const ticketOutcome = settlement?.outcome ?? "PENDING";
              const recorded = ticketOutcome !== "PENDING" ? parseSettlementEvidence(settlement?.evidence).find((row) => row.fixtureId === leg.fixtureId) : undefined;
              const outcome = displayLegOutcome(recorded, leg.marketKey, leg.selection, selectedFixture).outcome;
              const target = leg.ticketVersion.targetDate.toISOString().slice(0, 10);
              return <tr key={leg.id}>
                <td><Link href={`/results?from=${target}&to=${target}`}>{leg.ticketVersion.tier} · {target}</Link></td>
                <td>{label(leg.marketKey)}: {label(leg.selection)}</td>
                <td>{Number(leg.decimalOdds).toFixed(2)}</td>
                <td><span className={`status-badge ${outcome.toLowerCase()}`}>{LEG_OUTCOME_LABEL[outcome] ?? outcome}</span></td>
                <td><span className={`status-badge ${ticketOutcome.toLowerCase()}`}>{ticketOutcome}</span></td>
              </tr>;
            })}</tbody>
          </table></div>
        </>}

        <h3>Model probabilities</h3>
        {marketResults.length === 0 ? <p>No model forecast is stored for this fixture.</p> : <div className="research-probabilities">{marketResults.map(({ market, rows, outcomes }) => <div className="research-market" key={market}>
          <strong>{label(market)}</strong>
          <div>{outcomes.map(({ row, hit }) => <span key={`${row.modelRunId}-${row.selection}`} className={hit ? "research-hit" : undefined}><b>{label(row.selection)}{hit ? " ✓" : ""}</b>{pct(Number(row.probability))}</span>)}</div>
          <small>{rows[0] ? `${rows[0].modelRun.method} · trained through ${dateTime(rows[0].modelRun.trainedUntil)} · forecast ${dateTime(rows[0].asOfAt)}` : ""}</small>
        </div>)}</div>}
        <h3>Captured prices</h3>
        <p className="meta">Quotes are grouped by market and selection. Each record was captured before kickoff; this feed may be incomplete between provider snapshots.</p>
        {selectedFixture.quotes.length === 0 ? <p>No locally captured prices for this fixture.</p> : <div className="matches-table-wrap"><table className="matches-table"><thead><tr><th>Market</th><th>Selection</th><th>Bookmaker</th><th>Odds</th><th>Movement</th><th>Captured</th><th>Provider update</th></tr></thead><tbody>{selectedFixture.quotes.map((quote, index) => {
          const older = selectedFixture.quotes.slice(index + 1).find((candidate) => candidate.bookmakerId === quote.bookmakerId && candidate.marketId === quote.marketId && candidate.selection === quote.selection);
          const change = older ? (Number(quote.decimalOdds) - Number(older.decimalOdds)) / Number(older.decimalOdds) * 100 : null;
          return <tr key={quote.id}><td>{quote.market.normalizedKey ?? quote.market.name}</td><td>{quote.selection}</td><td>{quote.bookmaker.name}</td><td>{Number(quote.decimalOdds).toFixed(2)}</td><td>{change === null ? "First capture" : `${change > 0 ? "+" : ""}${change.toFixed(1)}% vs previous`}</td><td>{dateTime(quote.capturedAt)}</td><td>{quote.providerUpdatedAt ? dateTime(quote.providerUpdatedAt) : "Not supplied"}</td></tr>;
        })}</tbody></table></div>}
      </article>}
    </div>}
  </section>;
}
