import { db } from "@highodds/db";
import { clvPercent } from "@highodds/core";

type ClosingQuote = { fixtureId: string; marketId: string; selection: string; bookmakerId: string; decimalOdds: unknown };

/** Mean closing-line value across the legs of the given tickets, or null when no leg has a closing price. */
export async function averageClv(ticketIds: string[]): Promise<number | null> {
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
