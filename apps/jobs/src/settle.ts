import { db } from "@highodds/db";
import { resolveSelection } from "./markets.js";

export async function settleResults(now: Date): Promise<{ settled: number; pending: number }> {
  const candidates = await db.ticketVersion.findMany({
    where: { lockAt: { lte: now }, settlements: { none: {} }, successors: { none: {} } },
    include: { legs: { include: { fixture: true } } }
  });

  let settled = 0; let pending = 0;
  for (const ticket of candidates) {
    const unresolved = ticket.legs.some((leg) => leg.fixture.status === "SCHEDULED" || leg.fixture.status === "LIVE");
    if (unresolved) { pending += 1; continue; }

    const voided = ticket.legs.some((leg) => leg.fixture.status === "POSTPONED" || leg.fixture.status === "CANCELLED");
    const evidence = ticket.legs.map((leg) => ({
      fixtureId: leg.fixtureId, marketKey: leg.marketKey, selection: leg.selection,
      status: leg.fixture.status, homeGoals: leg.fixture.homeGoals, awayGoals: leg.fixture.awayGoals,
      result: leg.fixture.status === "FINISHED" ? resolveSelection(leg.marketKey, leg.selection, leg.fixture.homeGoals!, leg.fixture.awayGoals!) : null
    }));

    let outcome: "WIN" | "LOSS" | "VOID";
    let profitUnits: number;
    if (voided) {
      outcome = "VOID"; profitUnits = 0;
    } else {
      const allWin = evidence.every((leg) => leg.result === "WIN");
      outcome = allWin ? "WIN" : "LOSS";
      profitUnits = allWin ? Number(ticket.combinedOdds) - 1 : -1;
    }

    await db.settlement.create({ data: { ticketVersionId: ticket.id, outcome, profitUnits, settledAt: now, evidence: evidence as unknown as object } });
    settled += 1;
  }
  return { settled, pending };
}
