import { redirect } from "next/navigation";
import { db } from "@highodds/db";
import { auth } from "../../auth";
import { blantyreDayBounds, blantyreToday, forecastEvidence, highProbabilityPick, legOutcome, parseIsoDay, probabilityThreshold, PROBABILITY_THRESHOLDS, utcDate, type StoredPrediction } from "@highodds/core";
import { LEG_OUTCOME_LABEL, shortPickLabel } from "../../lib/selection";
import { loadTicketCards } from "../../lib/tickets";
import { loadTotalGoalsRuleDay } from "../../lib/total-goals";
import { loadDailyModelPicks } from "../../lib/analysis";
import { loadForecastEvidence } from "../../lib/forecast-evidence";
import { DayNav, formatDay } from "../date-nav";
import TicketBoard from "./ticket-board";
import TotalGoalsRule from "./total-goals-rule";
import ModelPicks from "./model-picks";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<string, string> = { STANDARD: "Standard", VALUE: "Value", HIGH: "High" };

const BLANTYRE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Blantyre", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});
const BLANTYRE_RECEIVED = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Blantyre", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ date?: string | string[]; minProbability?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const { date, minProbability } = await searchParams;
  const minimumPercent = probabilityThreshold(minProbability);
  // Ticket target dates are UTC days (matching the publish schedule); fixtures use the same day in Blantyre time.
  const now = new Date();
  const today = blantyreToday(now);
  const day = parseIsoDay(date) ?? today;
  const isToday = day === today;
  const localDay = blantyreDayBounds(day);

  const [cardData, totalGoalsRule, dailyModelPicks, fixtures] = await Promise.all([
    loadTicketCards({ targetDate: utcDate(day) }),
    loadTotalGoalsRuleDay(day),
    loadDailyModelPicks(day),
    db.fixture.findMany({
      where: { kickoff: { gte: localDay.start, lt: localDay.end } },
      orderBy: [{ kickoff: "asc" }, { id: "asc" }],
      select: { id: true, competitionId: true, kickoff: true, status: true, homeGoals: true, awayGoals: true, receivedAt: true, competition: { select: { name: true } }, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } }
    })
  ]);

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
    const pick = highProbabilityPick(predictionsByFixture.get(fixture.id) ?? [], fixture.kickoff, now, minimumPercent);
    return pick ? [{ fixture, pick }] : [];
  });
  const evidenceRows = await loadForecastEvidence(modelPickFixtures.map(({ fixture, pick }) => ({
    fixtureId: fixture.id, competitionId: fixture.competitionId, forecastAt: pick.asOfAt
  })));

  return (
    <section>
      <p className="eyebrow">{isToday ? "TODAY'S RESEARCH" : "RESEARCH HISTORY"}</p>
      <h1>Today&apos;s research</h1>
      <DayNav basePath="/dashboard" day={day} today={today} allowFuture params={{ minProbability: String(minimumPercent) }} />
      <p className="page-intro">Published paper tickets and high-probability model picks for <strong>{formatDay(day)}</strong>, with historical evidence alongside each forecast.</p>
      <p><a className="inline-action" href="#matches-title">View {modelPickFixtures.length} matches at {minimumPercent}% and above for {day} (Blantyre time) ↓</a></p>

      {cardData.length === 0 && <div className="notice">{isToday ? "No qualified selections today. Insufficient evidence to publish a paper ticket." : `No paper ticket was published for ${formatDay(day)}.`}</div>}
      <TicketBoard tickets={cardData} />
      <details className="secondary-evidence">
        <summary>Show model signals and supporting rules <small>Useful context when you want to inspect how today’s ticket was formed</small></summary>
        <TotalGoalsRule data={totalGoalsRule} />
        <ModelPicks day={day} picks={dailyModelPicks} />
      </details>

      <section className="matches-section" aria-labelledby="matches-title">
        <h2 id="matches-title">{isToday ? "Today's high-probability matches" : `High-probability matches on ${formatDay(day)}`}</h2>
        <form className="date-form probability-filter" action="/dashboard" method="get">
          <label>Date <input type="date" name="date" defaultValue={day} required /></label>
          <label>Model probability <select name="minProbability" defaultValue={String(minimumPercent)}>{PROBABILITY_THRESHOLDS.map((threshold) => <option key={threshold} value={threshold}>{threshold}% and above</option>)}</select></label>
          <button type="submit" className="date-go">Show matches</button>
        </form>
        <p>{modelPickFixtures.length} matches at {minimumPercent}% and above. One strongest selection from each match&apos;s latest eligible pre-kickoff forecast batch. Times are Africa/Blantyre. These are research signals; probability alone does not qualify a paper ticket.</p>
        {modelPickFixtures.length === 0 ? <div className="notice">No matches have an eligible model pick at {minimumPercent}% and above for {formatDay(day)}. Try a lower threshold or another date.</div> : (
          <div className="matches-table-wrap">
            <table className="matches-table">
              <thead><tr><th>Time</th><th>Match</th><th>Competition</th><th>Status</th><th>Score</th><th>Model pick</th><th>Historical evidence</th><th>Ticket</th><th>Last received</th></tr></thead>
              <tbody>{modelPickFixtures.map(({ fixture, pick }) => {
                const pickOutcome = pick ? legOutcome(pick.marketKey!, pick.selection, fixture) : null;
                const legs = legsByFixture.get(fixture.id) ?? [];
                const evidence = forecastEvidence(evidenceRows, { fixtureId: fixture.id, competitionId: fixture.competitionId,
                  market: pick.marketKey!, selection: pick.selection, method: pick.method, probability: pick.probability, forecastAt: pick.asOfAt });
                return (
                  <tr key={fixture.id}>
                    <td>{BLANTYRE_TIME.format(fixture.kickoff)}</td>
                    <td><a href={`/research?date=${day}&fixture=${fixture.id}`}>{fixture.homeTeam.name} vs {fixture.awayTeam.name}</a></td>
                    <td>{fixture.competition.name}</td>
                    <td>{fixture.status}</td>
                    <td>{fixture.homeGoals !== null && fixture.awayGoals !== null ? `${fixture.homeGoals}–${fixture.awayGoals}` : "—"}</td>
                    <td className="match-pick">{pick ? <>
                      <span>{shortPickLabel(pick.marketKey!, pick.selection)} <small>{(pick.probability * 100).toFixed(1)}%</small></span>
                      {pickOutcome && pickOutcome !== "PENDING" && <span className={`status-badge leg-outcome ${pickOutcome.toLowerCase()}`}>{LEG_OUTCOME_LABEL[pickOutcome]}</span>}
                    </> : <span className="match-pick-none">—</span>}</td>
                    <td className="match-calibration">
                      <p>{evidence.observed === null ? "No comparable completed matches." : <>Similar forecasts won <strong>{(evidence.observed * 100).toFixed(1)}%</strong> across <strong>{evidence.matches} matches</strong> ({evidence.wins} wins).</>}</p>
                      <p className="meta">{evidence.matches === 0 ? "Reliability unknown." : evidence.matches < 30 ? "Small sample: reliability remains uncertain." : "Historical evidence; match outcome remains uncertain."}</p>
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
                    <td>{BLANTYRE_RECEIVED.format(fixture.receivedAt)}</td>
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
