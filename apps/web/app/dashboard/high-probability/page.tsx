import { redirect } from "next/navigation";
import { db } from "@highodds/db";
import { auth } from "../../../auth";
import { blantyreDayBounds, blantyreToday, forecastEvidence, highProbabilityPick, legOutcome, parseIsoDay, probabilityThreshold, PROBABILITY_THRESHOLDS, type StoredPrediction } from "@highodds/core";
import { LEG_OUTCOME_LABEL, selectionLabel, shortPickLabel } from "../../../lib/selection";
import { loadForecastEvidence } from "../../../lib/forecast-evidence";
import { DayNav, formatDay } from "../../date-nav";
import { MODEL_PICK_FILTERS, modelPickFilter } from "@highodds/core";
import { ResearchPerformanceSummary, ResearchStakeInput } from "../../research-performance";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<string, string> = { STANDARD: "Standard", VALUE: "Value", HIGH: "High" };
const MARKET_LABEL: Record<string, string> = { MATCH_WINNER: "Match winner", TOTAL_GOALS: "Total goals", BTTS: "Both teams score" };

const BLANTYRE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Blantyre", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});
const BLANTYRE_RECEIVED = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Blantyre", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ date?: string | string[]; minProbability?: string | string[]; pick?: string | string[]; stake?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const { date, minProbability, pick: pickParam, stake } = await searchParams;
  const minimumPercent = probabilityThreshold(minProbability);
  const pickFilter = modelPickFilter(pickParam);
  const parsedStake = typeof stake === "string" ? Number(stake) : NaN;
  const simulatorStake = Number.isFinite(parsedStake) ? Math.min(1_000_000, Math.max(0.01, parsedStake)) : 1;
  // Ticket target dates are UTC days (matching the publish schedule); fixtures use the same day in Blantyre time.
  const now = new Date();
  const today = blantyreToday(now);
  const day = parseIsoDay(date) ?? today;
  const isToday = day === today;
  const localDay = blantyreDayBounds(day);

  const fixtures = await db.fixture.findMany({
      where: { kickoff: { gte: localDay.start, lt: localDay.end } },
      orderBy: [{ kickoff: "asc" }, { id: "asc" }],
      select: { id: true, competitionId: true, kickoff: true, status: true, homeGoals: true, awayGoals: true, competition: { select: { name: true } }, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } }
    });

  const fixtureIds = fixtures.map((fixture) => fixture.id);
  const [predictions, ticketLegs] = fixtureIds.length === 0 ? [[], []] : await Promise.all([
    db.prediction.findMany({
      where: { fixtureId: { in: fixtureIds } },
      orderBy: [{ asOfAt: "desc" }, { id: "asc" }],
      select: { fixtureId: true, selection: true, probability: true, asOfAt: true, modelRun: { select: { method: true, trainedUntil: true } }, market: { select: { normalizedKey: true } } }
    }),
    db.ticketLeg.findMany({
      where: { fixtureId: { in: fixtureIds }, ticketVersion: { successors: { none: {} } } },
      select: { fixtureId: true, marketKey: true, selection: true, ticketVersion: { select: { tier: true } } }
    })
  ]);
  const predictionsByFixture = new Map<string, (StoredPrediction & { method: string; trainedUntil: Date })[]>();
  for (const row of predictions) {
    const list = predictionsByFixture.get(row.fixtureId) ?? [];
    list.push({ marketKey: row.market.normalizedKey, selection: row.selection, probability: Number(row.probability), asOfAt: row.asOfAt, method: row.modelRun.method, trainedUntil: row.modelRun.trainedUntil });
    predictionsByFixture.set(row.fixtureId, list);
  }
  const legsByFixture = new Map<string, typeof ticketLegs>();
  for (const leg of ticketLegs) legsByFixture.set(leg.fixtureId, [...(legsByFixture.get(leg.fixtureId) ?? []), leg]);
  const modelPickFixtures = fixtures.flatMap((fixture) => {
    const pick = highProbabilityPick(predictionsByFixture.get(fixture.id) ?? [], fixture.kickoff, now, minimumPercent, pickFilter);
    return pick ? [{ fixture, pick }] : [];
  });
  const selectionSummary = new Map<string, { market: string; selection: string; selected: number; settled: number; won: number; lost: number; voided: number }>();
  for (const { fixture, pick } of modelPickFixtures) {
    const market = pick.marketKey!;
    const key = `${market}\u0000${pick.selection}`;
    const row = selectionSummary.get(key) ?? { market, selection: pick.selection, selected: 0, settled: 0, won: 0, lost: 0, voided: 0 };
    const outcome = legOutcome(market, pick.selection, fixture);
    row.selected += 1;
    if (outcome === "WIN") { row.settled += 1; row.won += 1; }
    else if (outcome === "LOSS") { row.settled += 1; row.lost += 1; }
    else if (outcome === "VOID") row.voided += 1;
    selectionSummary.set(key, row);
  }
  const selectionSummaryRows = [...selectionSummary.values()].sort((a, b) => a.market.localeCompare(b.market) || a.selection.localeCompare(b.selection));
  const [evidenceRows, quotes] = await Promise.all([
    loadForecastEvidence(modelPickFixtures.map(({ fixture, pick }) => ({ fixtureId: fixture.id, competitionId: fixture.competitionId, forecastAt: pick.asOfAt }))),
    modelPickFixtures.length ? db.oddsQuote.findMany({
      where: { fixtureId: { in: modelPickFixtures.map(({ fixture }) => fixture.id) }, bookmaker: { active: true }, capturedAt: { lte: now } },
      select: { fixtureId: true, selection: true, decimalOdds: true, capturedAt: true, bookmaker: { select: { name: true, priority: true } }, market: { select: { normalizedKey: true } } }
    }) : []
  ]);
  const displayedPicks = modelPickFixtures.map(({ fixture, pick }) => {
    const quote = quotes.filter((item) => item.fixtureId === fixture.id && item.market.normalizedKey === pick.marketKey && item.selection === pick.selection
      && item.capturedAt >= pick.asOfAt && item.capturedAt < fixture.kickoff)
      .sort((a, b) => a.bookmaker.priority - b.bookmaker.priority || a.capturedAt.getTime() - b.capturedAt.getTime())[0] ?? null;
    return { fixture, pick, quote, outcome: legOutcome(pick.marketKey!, pick.selection, fixture) };
  });
  const pricedPicks = displayedPicks.filter((row) => row.quote !== null);
  const simulatedSettled = pricedPicks.filter((row) => row.outcome === "WIN" || row.outcome === "LOSS");
  const simulatedWins = simulatedSettled.filter((row) => row.outcome === "WIN");
  const simulatedLosses = simulatedSettled.length - simulatedWins.length;
  const simulationReturnsPerUnit = simulatedWins.reduce((sum, row) => sum + Number(row.quote!.decimalOdds), 0);
  const simulationNetPerUnit = simulationReturnsPerUnit - simulatedSettled.length;
  const selectionSummaryTable = <section className="high-probability-summary" aria-labelledby="high-probability-summary-title">
    <div className="section-heading"><div><p className="eyebrow">SELECTION SUMMARY</p><h3 id="high-probability-summary-title">Selected market performance</h3></div><p className="meta">For the date and filters above</p></div>
    <div className="matches-table-wrap"><table className="matches-table high-probability-summary-table">
      <thead><tr><th>Selected market</th><th>Selection</th><th>Selected</th><th>Settled</th><th>Won</th><th>Lost</th><th>Hit rate</th></tr></thead>
      <tbody>{selectionSummaryRows.length === 0 ? <tr><td colSpan={7}>No selections meet the current filters.</td></tr> : selectionSummaryRows.map((row) => <tr key={`${row.market}-${row.selection}`}>
        <th scope="row">{MARKET_LABEL[row.market] ?? row.market}</th><td>{selectionLabel(row.selection)}</td><td className="num">{row.selected}</td><td className="num">{row.settled}</td><td className="num">{row.won}</td><td className="num">{row.lost}</td><td className="num">{row.settled ? `${(row.won / row.settled * 100).toFixed(1)}%` : "—"}</td>
      </tr>)}</tbody>
    </table></div>
    <p className="meta">Only won and lost selections are included in the hit-rate denominator. Pending and void selections remain out of the denominator.</p>
  </section>;

  return (
    <section>
      <p className="eyebrow">TODAY · MODEL FORECASTS</p>
      <h1>High Probability Matches</h1>
      <DayNav basePath="/dashboard/high-probability" day={day} today={today} allowFuture params={{ minProbability: String(minimumPercent), pick: pickFilter.value, stake: simulatorStake.toFixed(2) }} />
      <p className="page-intro">Compare model picks for <strong>{formatDay(day)}</strong> with historical calibration evidence.</p>

      <section className="matches-section" aria-label={isToday ? "Today's high-probability matches" : `High-probability matches on ${formatDay(day)}`}>
        <form className="date-form probability-filter" action="/dashboard/high-probability" method="get">
          <label>Date <input type="date" name="date" defaultValue={day} required /></label>
          <label>Model probability <select name="minProbability" defaultValue={String(minimumPercent)}>{PROBABILITY_THRESHOLDS.map((threshold) => <option key={threshold} value={threshold}>{threshold}% and above</option>)}</select></label>
          <label>Model pick <select name="pick" defaultValue={pickFilter.value}>{MODEL_PICK_FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select></label>
          <ResearchStakeInput initialStake={simulatorStake} />
          <button type="submit" className="date-go">Show matches</button>
        </form>
        <p className="filter-summary" role="status"><strong>{modelPickFixtures.length}</strong> signals · {pickFilter.label} · {minimumPercent}% and above · one strongest eligible forecast per match.</p>
        <section className="high-probability-simulation" aria-labelledby="simulation-title">
          <div className="section-heading"><div><p className="eyebrow">PAPER SIMULATION</p><h3 id="simulation-title">Returns at captured odds</h3></div><p className="meta">MWK stake per selection</p></div>
          <ResearchPerformanceSummary initialStake={simulatorStake} settledCount={simulatedSettled.length} wins={simulatedWins.length} losses={simulatedLosses} voids={pricedPicks.filter((row) => row.outcome === "VOID").length} pending={pricedPicks.filter((row) => row.outcome === "PENDING").length} returnsPerUnit={simulationReturnsPerUnit} netPerUnit={simulationNetPerUnit} roiPercent={simulatedSettled.length ? simulationNetPerUnit / simulatedSettled.length * 100 : null} />
          <p className="meta">Uses the first local active-bookmaker price captured after each forecast and before kickoff, choosing the configured bookmaker priority. {modelPickFixtures.length - pricedPicks.length} selection{modelPickFixtures.length - pricedPicks.length === 1 ? "" : "s"} without a usable captured price {modelPickFixtures.length - pricedPicks.length === 1 ? "is" : "are"} excluded.</p>
        </section>
        {selectionSummaryTable}
        {modelPickFixtures.length === 0 ? <div className="notice">No matches have {pickFilter.value === "ALL" ? "an eligible model pick" : `${pickFilter.label} as their strongest model pick`} at {minimumPercent}% and above for {formatDay(day)}. Try another model pick, a lower threshold or another date.</div> : (
          <div className="matches-table-wrap">
            <table className="matches-table">
              <thead><tr><th>Time</th><th>Match</th><th>Model pick</th><th>Match odds</th><th>Historical evidence</th><th>Paper ticket</th></tr></thead>
              <tbody>{displayedPicks.map(({ fixture, pick, quote, outcome: pickOutcome }) => {
                const legs = legsByFixture.get(fixture.id) ?? [];
                const evidence = forecastEvidence(evidenceRows, { fixtureId: fixture.id, competitionId: fixture.competitionId,
                  market: pick.marketKey!, selection: pick.selection, method: pick.method, probability: pick.probability, forecastAt: pick.asOfAt });
                return (
                  <tr key={fixture.id}>
                    <td>{BLANTYRE_TIME.format(fixture.kickoff)}</td>
                    <td className="match-summary"><a href={`/research?date=${day}&fixture=${fixture.id}`}>{fixture.homeTeam.name} vs {fixture.awayTeam.name}</a><small>{fixture.competition.name} · {fixture.status}{fixture.homeGoals !== null && fixture.awayGoals !== null ? ` · ${fixture.homeGoals}–${fixture.awayGoals}` : ""}</small></td>
                    <td className="match-pick">{pick ? <>
                      <span>{shortPickLabel(pick.marketKey!, pick.selection)} <small>{(pick.probability * 100).toFixed(1)}%</small></span>
                      {pickOutcome && pickOutcome !== "PENDING" && <span className={`status-badge leg-outcome ${pickOutcome.toLowerCase()}`}>{LEG_OUTCOME_LABEL[pickOutcome]}</span>}
                    </> : <span className="match-pick-none">—</span>}</td>
                    <td className="match-odds">{quote ? <><strong>{Number(quote.decimalOdds).toFixed(2)}</strong><small>{quote.bookmaker.name}<br />Captured {BLANTYRE_RECEIVED.format(quote.capturedAt)}</small></> : <span className="match-pick-none">No eligible active-bookmaker price</span>}</td>
                    <td className="match-calibration">
                      <p>{evidence.observed === null ? "No comparable results." : <>Observed <strong>{(evidence.observed * 100).toFixed(1)}%</strong> · <strong>{evidence.matches}</strong> comparisons</>}</p>
                      <p className="meta">{evidence.matches === 0 ? "Reliability unknown." : evidence.matches < 30 ? "Small sample." : "Historical comparison."}</p>
                      <details><summary>Calibration details</summary>
                        {evidence.interval && <p>95% win-rate interval: {(evidence.interval.lower * 100).toFixed(1)}–{(evidence.interval.upper * 100).toFixed(1)}%. Similar forecasts averaged {(evidence.predicted! * 100).toFixed(1)}%. Observed minus predicted: {((evidence.gap ?? 0) * 100).toFixed(1)} percentage points.</p>}
                        <p>Same competition, market, selection and model method; {(evidence.lower * 100).toFixed(0)}–{(evidence.upper * 100).toFixed(0)}% band (upper boundary excluded except 100%), preceding 180 days. Comparison ends at the forecast: {BLANTYRE_RECEIVED.format(pick.asOfAt)}.</p>
                        <p>One latest eligible forecast per match. Only finished results received before this forecast are included; later refreshed records are excluded. Model versions may differ. The interval assumes independent matches.</p>
                        <a href={`/research?date=${day}&fixture=${fixture.id}`}>Inspect this forecast</a> · <a href="/analysis#calibration">Market calibration</a>
                      </details>
                    </td>
                    <td className="match-pick">{legs.length === 0 ? <span className="match-pick-none">—</span> : legs.map((leg) => {
                      const outcome = legOutcome(leg.marketKey, leg.selection, fixture);
                      return <span key={`${leg.ticketVersion.tier}-${leg.marketKey}`} className="match-ticket-leg">
                        <span>{TIER_LABEL[leg.ticketVersion.tier] ?? leg.ticketVersion.tier}: {shortPickLabel(leg.marketKey, leg.selection)}</span>
                        {outcome !== "PENDING" && <span className={`status-badge leg-outcome ${outcome.toLowerCase()}`}>{LEG_OUTCOME_LABEL[outcome]}</span>}
                      </span>;
                    })}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
        <p className="meta">Fixture status is refreshed by the scheduled ingestion job; it is not a live score feed.</p>
      </section>
    </section>
  );
}
