import { describe, expect, it } from "vitest";
import { buildTickets } from "../src/tickets.js";
import type { CandidateLeg } from "../src/types.js";

const now = new Date("2026-09-20T06:00:00Z");
function leg(fixtureId: string, odds: number): CandidateLeg { return { fixtureId, bookmakerId: "preferred", market: "MATCH_WINNER", selection: "HOME", decimalOdds: odds, capturedAt: now, kickoff: new Date("2026-09-20T12:00:00Z"), modelProbability: 0.6, consensusProbability: 0.5, conservativeExpectedValue: 0.1, confidenceScore: 70, leagueId: fixtureId }; }

describe("ticket construction", () => {
  it("builds same-bookmaker, one-fixture-per-leg tickets", () => {
    const drafts = buildTickets([leg("a", 2), leg("b", 2.5), leg("c", 2.2), leg("d", 2.1)], ["preferred"], now);
    const standard = drafts.find((draft) => draft.tier.key === "STANDARD");
    expect(standard?.combinedOdds).toBeGreaterThanOrEqual(5);
    expect(new Set(standard?.legs.map((item) => item.fixtureId) ?? []).size).toBe(standard?.legs.length);
  });
});
