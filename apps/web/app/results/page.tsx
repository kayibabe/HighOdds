import { db } from "@highodds/db";
import { blantyreDayBounds, computeRoi, resolveDayRange, utcDate, utcToday, type DayRange } from "@highodds/core";
import { averageClv } from "../../lib/clv";
import { loadTicketCards } from "../../lib/tickets";
import TicketBoard, { type TicketCardData } from "../dashboard/ticket-board";
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

function groupTickets(tickets: TicketCardData[]) {
  const years = new Map<string, Map<string, Map<string, TicketCardData[]>>>();
  for (const ticket of tickets) {
    const year = ticket.targetDate.slice(0, 4);
    const month = ticket.targetDate.slice(0, 7);
    const yearGroup = years.get(year) ?? new Map<string, Map<string, TicketCardData[]>>();
    const monthGroup = yearGroup.get(month) ?? new Map<string, TicketCardData[]>();
    const dayGroup = monthGroup.get(ticket.targetDate) ?? [];
    dayGroup.push(ticket);
    monthGroup.set(ticket.targetDate, dayGroup);
    yearGroup.set(month, monthGroup);
    years.set(year, yearGroup);
  }
  return years;
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00.000Z`));
}

function dayLabel(day: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00.000Z`));
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
    where: { stage: "SELECTION", fixture: { status: "FINISHED", kickoff: { lt: new Date() }, homeGoals: { not: null }, awayGoals: { not: null }, ...kickoffFilter(range) } },
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
  const ticketGroups = groupTickets(tickets);

  return (
    <section>
      <p className="eyebrow">VERIFIED PAPER HISTORY</p>
      <h1>Results &amp; Returns</h1>
      <p className="page-intro">Review settled paper tickets and walk-forward model quality for the selected period. Performance figures appear only after locally captured prices settle.</p>
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
          <section className="results-ticket-history" aria-labelledby="ticket-history-title">
            <div className="ticket-board-heading">
              <div><p className="eyebrow">TICKET HISTORY</p><h2 id="ticket-history-title">Accumulator tickets</h2></div>
              <p>{counts.WIN} won · {counts.LOSS} lost · {counts.VOID} void · {pendingCount} pending. Open a year, month, day, and then an accumulator to review its legs and evidence.</p>
            </div>
            <div className="results-ticket-years">
              {Array.from(ticketGroups.entries()).sort(([a], [b]) => b.localeCompare(a)).map(([year, months]) => {
                const yearTickets = Array.from(months.values()).reduce((sum, days) => sum + Array.from(days.values()).reduce((daySum, dayTickets) => daySum + dayTickets.length, 0), 0);
                return <details key={year} className="results-ticket-year">
                  <summary><strong>{year}</strong><small>{yearTickets} ticket{yearTickets === 1 ? "" : "s"}</small></summary>
                  <div className="results-ticket-months">
                    {Array.from(months.entries()).sort(([a], [b]) => b.localeCompare(a)).map(([month, days]) => {
                      const monthTickets = Array.from(days.values()).reduce((sum, dayTickets) => sum + dayTickets.length, 0);
                      return <details key={month} className="results-ticket-month">
                        <summary><strong>{monthLabel(month)}</strong><small>{monthTickets} ticket{monthTickets === 1 ? "" : "s"}</small></summary>
                        <div className="results-ticket-days">
                          {Array.from(days.entries()).sort(([a], [b]) => b.localeCompare(a)).map(([day, dayTickets]) => <details key={day} className="results-ticket-day">
                            <summary><strong>{dayLabel(day)}</strong><small>{dayTickets.length} ticket{dayTickets.length === 1 ? "" : "s"}</small></summary>
                            <TicketBoard tickets={dayTickets} compact showHeading={false} />
                          </details>)}
                        </div>
                      </details>;
                    })}
                  </div>
                </details>;
              })}
            </div>
          </section>
          {ticketTotal > tickets.length && <p className="meta">Showing the latest {tickets.length} of {ticketTotal} tickets in this period. Narrow the dates to see older ones; the ROI and model figures above cover the whole period.</p>}
        </>}

      <details className="secondary-evidence results-model-quality">
      <summary>Show model quality <small>Walk-forward prediction quality, separate from ticket returns</small></summary>
      <h2>Model quality · walk-forward predictions</h2>
      <p>Only the latest prediction per fixture, market, and selection is included, and only when it was recorded before kickoff with a model trained no later than the forecast timestamp. Scores are pooled across supported markets and are descriptive; they are not proof of future performance.</p>
      <div className="grid">
        <article><h2>Scored predictions</h2><p>{scored.length}</p></article>
        <article><h2>Brier score</h2><p>{modelBrier === null ? "—" : modelBrier.toFixed(4)}</p></article>
        <article><h2>Excluded rows</h2><p>{excludedCount} (late forecast, model lookahead, or duplicate history)</p></article>
      </div>
      <p className="meta">Lower Brier is better; this pooled score can hide differences between markets and competitions. Market and competition breakdowns should follow once the evidence volume supports them.</p>
      </details>
    </section>
  );
}
