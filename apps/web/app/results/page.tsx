import { db } from "@highodds/db";
import { clvPercent, computeRoi } from "@highodds/core";

export const dynamic = "force-dynamic";

async function averageClv(ticketIds: string[]): Promise<number | null> {
  if (ticketIds.length === 0) return null;
  const legs = await db.ticketLeg.findMany({ where: { ticketVersionId: { in: ticketIds } }, include: { fixture: true, ticketVersion: { select: { bookmakerId: true } } } });
  const markets = await db.market.findMany({ where: { normalizedKey: { not: null } }, select: { id: true, normalizedKey: true } });
  const marketIdByKey = new Map(markets.map((market) => [market.normalizedKey!, market.id]));
  const values: number[] = [];
  for (const leg of legs) {
    const marketId = marketIdByKey.get(leg.marketKey);
    if (!marketId) continue;
    // Same bookmaker as the entry quote -- comparing across bookmakers would conflate CLV with cross-book price variance.
    const closing = await db.oddsQuote.findFirst({
      where: { fixtureId: leg.fixtureId, marketId, selection: leg.selection, bookmakerId: leg.ticketVersion.bookmakerId, capturedAt: { lt: leg.fixture.kickoff } },
      orderBy: { capturedAt: "desc" }
    });
    if (closing) values.push(clvPercent(Number(leg.decimalOdds), Number(closing.decimalOdds)));
  }
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export default async function ResultsPage() {
  const tickets = await db.ticketVersion.findMany({ take: 20, orderBy: { publishedAt: "desc" }, include: { settlements: true } });
  const settlementRows = await db.settlement.findMany({ include: { ticketVersion: { select: { tier: true } } } });
  const roiByTier = computeRoi(settlementRows.map((row) => ({ tier: row.ticketVersion.tier, outcome: row.outcome, profitUnits: row.profitUnits ? Number(row.profitUnits) : null })));
  const settledTicketIds = settlementRows.filter((row) => row.outcome !== "PENDING").map((row) => row.ticketVersionId);
  const clv = await averageClv(settledTicketIds);
  const historicalPredictions = await db.prediction.findMany({
    where: { fixture: { status: "FINISHED", kickoff: { lt: new Date() }, homeGoals: { not: null }, awayGoals: { not: null } } },
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

  return (
    <section>
      <p className="eyebrow">VERIFIED PAPER HISTORY</p>
      <h1>Ticket outcomes</h1>
      <p>Performance figures appear only after locally captured prices settle. Empty history is expected during setup.</p>
      <h2>Model quality · walk-forward predictions</h2>
      <p>Only the latest prediction per fixture, market, and selection is included, and only when it was recorded before kickoff with a model trained no later than the forecast timestamp. Scores are pooled across supported markets and are descriptive; they are not proof of future performance.</p>
      <div className="grid">
        <article><h2>Scored predictions</h2><p>{scored.length}</p></article>
        <article><h2>Brier score</h2><p>{modelBrier === null ? "—" : modelBrier.toFixed(4)}</p></article>
        <article><h2>Excluded rows</h2><p>{excludedCount} (late forecast, model lookahead, or duplicate history)</p></article>
      </div>
      <p className="meta">Lower Brier is better; this pooled score can hide differences between markets and competitions. Market and competition breakdowns should follow once the evidence volume supports them.</p>
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
      <ul className="tickets">{tickets.map((ticket) => <li key={ticket.id}><strong>{ticket.tier}</strong><span>{Number(ticket.combinedOdds).toFixed(2)}</span><span className={`status-badge ${(ticket.settlements[0]?.outcome ?? "PENDING").toLowerCase()}`}>{ticket.settlements[0]?.outcome ?? "PENDING"}</span></li>)}</ul>
      {tickets.length === 0 && <div className="notice">No published paper tickets yet.</div>}
    </section>
  );
}
