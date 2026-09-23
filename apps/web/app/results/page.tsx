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

  return (
    <section>
      <p className="eyebrow">VERIFIED PAPER HISTORY</p>
      <h1>Ticket outcomes</h1>
      <p>Performance figures appear only after locally captured prices settle. Empty history is expected during setup.</p>
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
