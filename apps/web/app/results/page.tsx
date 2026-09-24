import { db } from "@highodds/db";
import { blantyreDayBounds, clvPercent, computeRoi, resolveDayRange, utcDate, utcToday, type DayRange } from "@highodds/core";
import { loadTicketCards } from "../../lib/tickets";
import TicketBoard from "../dashboard/ticket-board";
import { RangeNav, rangeLabel } from "../date-nav";

export const dynamic = "force-dynamic";

const TICKET_LIMIT = 150;

function targetDateFilter(range: DayRange) {
  if (!range.from || !range.to) return {};
  return { targetDate: { gte: utcDate(range.from), lte: utcDate(range.to) } };
}

function kickoffFilter(range: DayRange) {
  if (!range.from || !range.to) return {};
  return { kickoff: { gte: blantyreDayBounds(range.from).start, lt: blantyreDayBounds(range.to).end } };
}

type ClosingQuote = { fixtureId: string; marketId: string; selection: string; bookmakerId: string; decimalOdds: unknown };

async function averageClv(ticketIds: string[]): Promise<number | null> {
  if (ticketIds.length === 0) return null;
  const legs = await db.ticketLeg.findMany({ where: { ticketVersionId: { in: ticketIds } }, include: { ticketVersion: { select: { bookmakerId: true } } } });
  const markets = await db.market.findMany({ where: { normalizedKey: { not: null } }, select: { id: true, normalizedKey: true } });
  const marketIdByKey = new Map(markets.map((market) => [market.normalizedKey!, market.id]));
  const fixtureIds = [...new Set(legs.map((leg) => leg.fixtureId))];
  if (fixtureIds.length === 0) return null;
  // One query for every leg's closing price: the last pre-kickoff quote per fixture/market/selection/bookmaker.
  // A year of history is thousands of legs, so the previous query-per-leg loop does not scale to range views.
  const closing = await db.$queryRaw<ClosingQuote[]>`
    SELECT DISTINCT ON (q."fixtureId", q."marketId", q."selection", q."bookmakerId")
      q."fixtureId", q."marketId", q."selection", q."bookmakerId", q."decimalOdds"
    FROM "OddsQuote" q JOIN "Fixture" f ON f."id" = q."fixtureId"
    WHERE q."fixtureId" = ANY(${fixtureIds}) AND q."capturedAt" < f."kickoff"
    ORDER BY q."fixtureId", q."marketId", q."selection", q."bookmakerId", q."capturedAt" DESC`;
  const closingByKey = new Map(closing.map((row) => [`${row.fixtureId}:${row.marketId}:${row.selection}:${row.bookmakerId}`, Number(row.decimalOdds)]));
  const values: number[] = [];
  for (const leg of legs) {
    const marketId = marketIdByKey.get(leg.marketKey);
    if (!marketId) continue;
    // Same bookmaker as the entry quote -- comparing across bookmakers would conflate CLV with cross-book price variance.
    const closingOdds = closingByKey.get(`${leg.fixtureId}:${marketId}:${leg.selection}:${leg.ticketVersion.bookmakerId}`);
    if (closingOdds !== undefined) values.push(clvPercent(Number(leg.decimalOdds), closingOdds));
  }
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export default async function ResultsPage({ searchParams }: { searchParams: Promise<{ range?: string | string[]; from?: string | string[]; to?: string | string[] }> }) {
  const params = await searchParams;
  const today = utcToday(new Date());
  const range = resolveDayRange(params, today);
  const period = rangeLabel(range);

  const [tickets, ticketTotal, settlementRows] = await Promise.all([
    loadTicketCards(targetDateFilter(range), TICKET_LIMIT),
    db.ticketVersion.count({ where: { ...targetDateFilter(range), successors: { none: {} } } }),
    db.settlement.findMany({ where: { ticketVersion: targetDateFilter(range) }, include: { ticketVersion: { select: { tier: true } } } })
  ]);
  const roiByTier = computeRoi(settlementRows.map((row) => ({ tier: row.ticketVersion.tier, outcome: row.outcome, profitUnits: row.profitUnits ? Number(row.profitUnits) : null })));
  const settledTicketIds = settlementRows.filter((row) => row.outcome !== "PENDING").map((row) => row.ticketVersionId);
  const clv = await averageClv(settledTicketIds);
  const historicalPredictions = await db.prediction.findMany({
    where: { fixture: { status: "FINISHED", kickoff: { lt: new Date() }, homeGoals: { not: null }, awayGoals: { not: null }, ...kickoffFilter(range) } },
    include: { fixture: { select: { kickoff: true, homeGoals: true, awayGoals: true } }, market: { select: { normalizedKey: true } }, modelRun: { select: { trainedUntil: true } } },
    orderBy: { asOfAt: "desc" }, take: 10000
  });
  const seen = new Set<string>();
  const scored = historicalPredictions.filter((prediction) => {
    const key = `${prediction.fixtureId}:${prediction.marketId}:${prediction.selection}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return prediction.asOfAt < prediction.fixture.kickoff && prediction.modelRun.trainedUntil <= prediction.asOfAt;
  }).filter((prediction) => prediction.market.normalizedKey !== "MATCH_WINNER" || ["HOME", "DRAW", "AWAY"].includes(prediction.selection));
  let brierSum = 0;
  for (const prediction of scored) {
    const { homeGoals, awayGoals } = prediction.fixture;
    const actual = prediction.market.normalizedKey === "MATCH_WINNER"
      ? (prediction.selection === "HOME" ? Number(homeGoals! > awayGoals!) : prediction.selection === "DRAW" ? Number(homeGoals === awayGoals) : Number(homeGoals! < awayGoals!))
      : prediction.market.normalizedKey === "TOTAL_GOALS"
        ? Number(prediction.selection === "OVER_2_5" ? homeGoals! + awayGoals! > 2 : homeGoals! + awayGoals! < 3)
        : Number(prediction.selection === "YES" ? homeGoals! > 0 && awayGoals! > 0 : homeGoals === 0 || awayGoals === 0);
    brierSum += (Number(prediction.probability) - actual) ** 2;
  }
  const modelBrier = scored.length ? brierSum / scored.length : null;
  const excludedCount = historicalPredictions.length - scored.length;

  // Tallied from settlements rather than the (capped) ticket list so the counts cover the whole period.
  const counts = { WIN: 0, LOSS: 0, VOID: 0 };
  for (const row of settlementRows) if (row.outcome !== "PENDING") counts[row.outcome] += 1;
  const pendingCount = ticketTotal - counts.WIN - counts.LOSS - counts.VOID;

  return (
    <section>
      <p className="eyebrow">VERIFIED PAPER HISTORY</p>
      <h1>Ticket outcomes</h1>
      <p>Performance figures appear only after locally captured prices settle. Empty history is expected during setup.</p>
      <RangeNav basePath="/results" range={range} today={today} />
      <p className="meta">Showing <strong>{period}</strong>. Tickets are grouped by their UTC target date; model quality uses fixtures kicking off in the same days (Blantyre time).</p>

      <div className="grid">
        {roiByTier.map((tier) => (
          <article key={tier.tier}>
            <h2>{tier.tier}</h2>
            <p>{tier.settled} settled &middot; {tier.wins}W {tier.losses}L {tier.voids}V</p>
            <p>ROI: {tier.settled > 0 ? `${tier.roiPercent.toFixed(1)}%` : "—"}</p>
          </article>
        ))}
      </div>
      <p>Average closing-line value across settled legs: {clv === null ? "—" : `${clv.toFixed(2)}%`}</p>

      {tickets.length === 0
        ? <div className="notice">No published paper tickets for {period}.</div>
        : <>
          <p className="results-tally" aria-label="Tickets by outcome in this period">
            <span className="status-badge win">{counts.WIN} won</span>
            <span className="status-badge loss">{counts.LOSS} lost</span>
            <span className="status-badge void">{counts.VOID} void</span>
            <span className="status-badge pending">{pendingCount} pending</span>
          </p>
          <TicketBoard tickets={tickets} eyebrow="TICKET HISTORY" title="Tickets and their legs" showDate />
          {ticketTotal > tickets.length && <p className="meta">Showing the latest {tickets.length} of {ticketTotal} tickets in this period. Narrow the dates to see older ones; the ROI and model figures above cover the whole period.</p>}
        </>}

      <h2>Model quality · walk-forward predictions</h2>
      <p>Only the latest prediction per fixture, market, and selection is included, and only when it was recorded before kickoff with a model trained no later than the forecast timestamp. Scores are pooled across supported markets and are descriptive; they are not proof of future performance.</p>
      <div className="grid">
        <article><h2>Scored predictions</h2><p>{scored.length}</p></article>
        <article><h2>Brier score</h2><p>{modelBrier === null ? "—" : modelBrier.toFixed(4)}</p></article>
        <article><h2>Excluded rows</h2><p>{excludedCount} (late forecast, model lookahead, or duplicate history)</p></article>
      </div>
      <p className="meta">Lower Brier is better; this pooled score can hide differences between markets and competitions. Market and competition breakdowns should follow once the evidence volume supports them.</p>
    </section>
  );
}
