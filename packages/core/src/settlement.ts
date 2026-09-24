/**
 * Leg-level settlement: how each accumulator leg resolved and which legs decided the ticket.
 * Shared by the settlement job (which writes the immutable evidence) and the web pages (which
 * read that evidence back, or preview it from live fixture state before the ticket settles).
 */

export type LegOutcome = "WIN" | "LOSS" | "VOID" | "PENDING" | "UNRESOLVED";
export type TicketOutcome = "WIN" | "LOSS" | "VOID" | "PENDING";

export interface LegFixtureState {
  status: string;
  homeGoals: number | null;
  awayGoals: number | null;
}

/** Resolves a settled leg to WIN/LOSS from final scoreline; null if the market/selection is unresolvable. */
export function resolveSelection(marketKey: string, selection: string, homeGoals: number, awayGoals: number): "WIN" | "LOSS" | null {
  if (marketKey === "MATCH_WINNER") {
    const result = homeGoals > awayGoals ? "HOME" : homeGoals < awayGoals ? "AWAY" : "DRAW";
    return selection === result ? "WIN" : "LOSS";
  }
  if (marketKey === "TOTAL_GOALS") {
    const over = homeGoals + awayGoals >= 3;
    if (selection === "OVER_2_5") return over ? "WIN" : "LOSS";
    if (selection === "UNDER_2_5") return over ? "LOSS" : "WIN";
    return null;
  }
  if (marketKey === "BTTS") {
    const btts = homeGoals > 0 && awayGoals > 0;
    if (selection === "YES") return btts ? "WIN" : "LOSS";
    if (selection === "NO") return btts ? "LOSS" : "WIN";
    return null;
  }
  return null;
}

/**
 * Mirrors settleResults: postponed/cancelled fixtures void the leg, a finished fixture resolves from
 * the final score, anything else is still pending. A finished fixture whose market cannot be
 * resolved is reported as UNRESOLVED rather than silently counted as a loss.
 */
export function legOutcome(marketKey: string, selection: string, fixture: LegFixtureState): LegOutcome {
  if (fixture.status === "POSTPONED" || fixture.status === "CANCELLED") return "VOID";
  if (fixture.status !== "FINISHED") return "PENDING";
  if (fixture.homeGoals === null || fixture.awayGoals === null) return "UNRESOLVED";
  return resolveSelection(marketKey, selection, fixture.homeGoals, fixture.awayGoals) ?? "UNRESOLVED";
}

export interface SettlementEvidenceLeg extends LegFixtureState {
  fixtureId: string;
  marketKey: string;
  selection: string;
  result: "WIN" | "LOSS" | null;
}

/** Reads the per-leg evidence settleResults stored on a Settlement; malformed rows are dropped. */
export function parseSettlementEvidence(value: unknown): SettlementEvidenceLeg[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SettlementEvidenceLeg => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    const goals = (goal: unknown) => goal === null || (typeof goal === "number" && Number.isInteger(goal));
    return typeof row.fixtureId === "string" && typeof row.marketKey === "string" && typeof row.selection === "string"
      && typeof row.status === "string" && goals(row.homeGoals) && goals(row.awayGoals)
      && (row.result === null || row.result === "WIN" || row.result === "LOSS");
  });
}

/** The outcome recorded at settlement time; the fixture row may have been corrected since. */
export function evidenceLegOutcome(leg: SettlementEvidenceLeg): LegOutcome {
  if (leg.status === "POSTPONED" || leg.status === "CANCELLED") return "VOID";
  if (leg.status !== "FINISHED") return "PENDING";
  return leg.result ?? "UNRESOLVED";
}

export interface TicketAttribution {
  /** Legs that decided (or, before settlement, are deciding) the ticket outcome. */
  decisiveLegIds: string[];
  counts: Record<LegOutcome, number>;
  summary: string;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Explains a ticket outcome from its legs. Settlement rules: any void leg voids the whole ticket,
 * otherwise every leg must win. Before settlement this previews the same rules against live state,
 * so a ticket with a lost leg is reported as already beaten.
 */
export function attributeTicket(outcome: TicketOutcome, legs: Array<{ id: string; outcome: LegOutcome }>): TicketAttribution {
  const counts: Record<LegOutcome, number> = { WIN: 0, LOSS: 0, VOID: 0, PENDING: 0, UNRESOLVED: 0 };
  for (const leg of legs) counts[leg.outcome] += 1;
  const ids = (...outcomes: LegOutcome[]) => legs.filter((leg) => outcomes.includes(leg.outcome)).map((leg) => leg.id);
  const total = legs.length;

  if (outcome === "VOID") {
    return { decisiveLegIds: ids("VOID"), counts, summary: `Voided by ${plural(counts.VOID, "postponed or cancelled leg")}; any void leg voids the ticket.` };
  }
  if (outcome === "WIN") {
    return { decisiveLegIds: ids("WIN"), counts, summary: `All ${plural(total, "leg")} won.` };
  }
  if (outcome === "LOSS") {
    const failed = counts.LOSS + counts.UNRESOLVED;
    const detail = counts.UNRESOLVED > 0 ? ` (${counts.UNRESOLVED} could not be resolved from the score)` : "";
    return { decisiveLegIds: ids("LOSS", "UNRESOLVED"), counts, summary: `Lost on ${failed} of ${plural(total, "leg")}${detail}; ${counts.WIN} won.` };
  }
  if (counts.VOID > 0) {
    return { decisiveLegIds: ids("VOID"), counts, summary: `Heading for void: ${plural(counts.VOID, "leg")} postponed or cancelled. Awaiting settlement.` };
  }
  if (counts.LOSS > 0) {
    return { decisiveLegIds: ids("LOSS"), counts, summary: `Already beaten by ${plural(counts.LOSS, "losing leg")}; ${counts.WIN} won, ${counts.PENDING} still to play. Awaiting settlement.` };
  }
  if (counts.PENDING === 0 && counts.UNRESOLVED === 0 && total > 0) {
    return { decisiveLegIds: [], counts, summary: `All ${plural(total, "leg")} won. Awaiting settlement.` };
  }
  return { decisiveLegIds: [], counts, summary: `${counts.WIN} of ${plural(total, "leg")} won so far; ${counts.PENDING + counts.UNRESOLVED} pending.` };
}
