import type { DailyModelPick } from "../../lib/analysis";
import type { TicketCardData } from "./ticket-board";

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function pct(value: number | null): string {
  return value === null ? "Unavailable" : `${(value * 100).toFixed(1)}%`;
}

function outcomeLabel(outcome: string): string {
  return outcome === "PENDING" ? "Open / unsettled" : outcome;
}

/**
 * A decision-first summary for the daily research page. It intentionally names
 * paper outputs and finished evidence separately so a historical signal is not
 * presented as a live betting opportunity.
 */
export default function TodaySummary({ tickets, picks }: { tickets: TicketCardData[]; picks: DailyModelPick[] }) {
  const legs = tickets.flatMap((ticket) => ticket.legs);
  const fixtureIds = new Set(legs.map((leg) => `${leg.home}:${leg.away}:${leg.kickoff}`));
  const probabilities = [...legs, ...picks].map((row) => row.probability).filter(Number.isFinite);
  const settled = tickets.filter((ticket) => ticket.outcome !== "PENDING");
  const paperProfit = settled.reduce((sum, ticket) => sum + (ticket.profitUnits ?? 0), 0);
  const won = settled.filter((ticket) => ticket.outcome === "WIN").length;
  const loss = settled.filter((ticket) => ticket.outcome === "LOSS").length;
  const avgProbability = average(probabilities);
  const missingQuotes = legs.filter((leg) => leg.quoteCapturedAt === null).length;
  const evidenceStatus = missingQuotes > 0 ? "Review" : tickets.length || picks.length ? "Recorded" : "No evidence";

  return <>
    <div className="today-summary-head">
      <div>
        <p className="eyebrow">DECISION OVERVIEW</p>
        <h2>Today&apos;s betting intelligence</h2>
      </div>
      <p>Start with the decision, then open a leg for its recorded probability, price, evidence, and result. All outputs remain paper research.</p>
    </div>
    <div className="analysis-kpis today-summary-kpis" aria-label="Today's research summary">
      <article><small>Matches in published tickets</small><strong>{fixtureIds.size}</strong><span>Unique ticketed fixtures</span></article>
      <article><small>Published paper tickets</small><strong>{tickets.length}</strong><span>{tickets.filter((ticket) => ticket.outcome === "PENDING").length} still open</span></article>
      <article><small>Ticketed legs</small><strong>{legs.length}</strong><span>Immutable published selections</span></article>
      <article><small>Finished model signals</small><strong>{picks.length}</strong><span>Walk-forward historical evidence</span></article>
      <article><small>Average recorded probability</small><strong>{pct(avgProbability)}</strong><span>Across tickets and signals</span></article>
      <article className={settled.length && paperProfit < 0 ? "attention" : undefined}><small>Paper result</small><strong>{settled.length ? `${paperProfit >= 0 ? "+" : ""}${paperProfit.toFixed(2)} u` : "Pending"}</strong><span>{settled.length ? `${won} wins · ${loss} losses · ${outcomeLabel("VOID")} excluded` : "No settled ticket yet"}</span></article>
      <article className={missingQuotes > 0 ? "attention" : undefined}><small>Evidence status</small><strong>{evidenceStatus}</strong><span>{missingQuotes > 0 ? `${missingQuotes} ticketed leg${missingQuotes === 1 ? "" : "s"} without quote timestamp` : "No missing ticket quote timestamps"}</span></article>
    </div>
    <div className="decision-guide" aria-label="Decision language">
      <strong>How to read the desk</strong>
      <span><b className="decision-badge bet">BET</b> Published paper selection</span>
      <span><b className="decision-badge watch">WATCH</b> Supporting signal, not a ticket</span>
      <span><b className="decision-badge pass">PASS</b> No qualified selection is valid</span>
    </div>
  </>;
}
