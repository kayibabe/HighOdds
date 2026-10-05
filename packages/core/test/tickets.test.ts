import { describe, expect, it } from "vitest";
import { AWAY_WIN_GUARD_MIN_MODEL_IMPLIED_EDGE, buildTickets, buildTicketsAround, legEligibility, legEligibilityForTier, modelImpliedEdge, TICKET_TIERS } from "../src/tickets.js";
import type { CandidateLeg, TicketDraft } from "../src/types.js";

const now = new Date("2026-09-20T06:00:00Z");
function leg(fixtureId: string, odds: number, overrides: Partial<CandidateLeg> = {}): CandidateLeg { return { fixtureId, bookmakerId: "preferred", market: "MATCH_WINNER", selection: "HOME", decimalOdds: odds, capturedAt: now, kickoff: new Date("2026-09-20T12:00:00Z"), modelProbability: 0.6, consensusProbability: 0.5, conservativeExpectedValue: 0.1, confidenceScore: 70, leagueId: fixtureId, ...overrides }; }
const fixturesOf = (drafts: TicketDraft[]) => drafts.flatMap((draft) => draft.legs.map((item) => item.fixtureId));

describe("ticket construction", () => {
  it("gates low model-implied edge only for away wins in the 1.80-1.99 band", () => {
    const guarded = leg("away-low-edge", 1.9, { selection: "AWAY", modelProbability: 0.55 });
    const unguardedHome = leg("home-low-edge", 1.9, { selection: "HOME", modelProbability: 0.55 });
    const outsideBand = leg("away-outside-band", 2, { selection: "AWAY", modelProbability: 0.55 });

    expect(modelImpliedEdge(guarded)).toBeCloseTo(0.55 - 1 / 1.9, 8);
    expect(modelImpliedEdge(guarded)).toBeLessThan(AWAY_WIN_GUARD_MIN_MODEL_IMPLIED_EDGE);
    expect(legEligibility(guarded, now)).toEqual({ eligible: false, reason: "AWAY_WIN_1_80_1_99_MODEL_EDGE_BELOW_5PP" });
    expect(legEligibility(unguardedHome, now)).toEqual({ eligible: true });
    expect(legEligibility(outsideBand, now)).toEqual({ eligible: true });
  });

  it("allows a guarded away win when its model-implied edge clears five points", () => {
    const guarded = leg("away-high-edge", 1.95, { selection: "AWAY", modelProbability: 0.57 });

    expect(modelImpliedEdge(guarded)).toBeGreaterThan(AWAY_WIN_GUARD_MIN_MODEL_IMPLIED_EDGE);
    expect(legEligibility(guarded, now)).toEqual({ eligible: true });
  });

  it("keeps the away-win restriction tier-specific and rejects Standard-tier long shots", () => {
    const standard = TICKET_TIERS.find((tier) => tier.key === "STANDARD")!;
    const value = TICKET_TIERS.find((tier) => tier.key === "VALUE")!;
    const high = TICKET_TIERS.find((tier) => tier.key === "HIGH")!;
    const retained = leg("away-standard", 3.5, { selection: "AWAY", modelProbability: 0.4 });
    const lowProbability = leg("away-low-probability", 3.5, { selection: "AWAY", modelProbability: 0.34 });
    const longShot = leg("away-long-shot", 4, { selection: "AWAY", modelProbability: 0.4 });

    expect(legEligibilityForTier(retained, standard, now)).toEqual({ eligible: true });
    expect(legEligibilityForTier(retained, value, now)).toEqual({ eligible: false, reason: "AWAY_WIN_NOT_ALLOWED_IN_VALUE_HIGH" });
    expect(legEligibilityForTier(retained, high, now)).toEqual({ eligible: false, reason: "AWAY_WIN_NOT_ALLOWED_IN_VALUE_HIGH" });
    expect(legEligibilityForTier(lowProbability, standard, now)).toEqual({ eligible: false, reason: "AWAY_WIN_STANDARD_MODEL_PROBABILITY_BELOW_35PCT" });
    expect(legEligibilityForTier(longShot, standard, now)).toEqual({ eligible: false, reason: "AWAY_WIN_STANDARD_ODDS_4_00_OR_HIGHER" });
  });

  it("does not use otherwise viable away wins to construct Value or High tickets", () => {
    const candidates = [
      leg("away-a", 2.5, { selection: "AWAY", modelProbability: 0.4 }),
      leg("away-b", 2.5, { selection: "AWAY", modelProbability: 0.4 }),
      leg("away-c", 2.5, { selection: "AWAY", modelProbability: 0.4 })
    ];
    const drafts = buildTickets(candidates, ["preferred"], now, { skipTiers: ["STANDARD"] });
    expect(drafts).toEqual([]);
  });

  it("builds same-bookmaker, one-fixture-per-leg tickets", () => {
    const drafts = buildTickets([leg("a", 2), leg("b", 2.5), leg("c", 2.2), leg("d", 2.1)], ["preferred"], now);
    const standard = drafts.find((draft) => draft.tier.key === "STANDARD");
    expect(standard?.combinedOdds).toBeGreaterThanOrEqual(5);
    expect(new Set(standard?.legs.map((item) => item.fixtureId) ?? []).size).toBe(standard?.legs.length);
  });

  it("never reuses a fixture across tiers, even via a different market", () => {
    // Mirrors the 2026-09-23 slate that produced nested STANDARD ⊂ VALUE ⊂ HIGH tickets, plus a
    // BTTS leg on fixture "b" that must not sneak into a second ticket.
    const candidates = [
      leg("a", 4.5, { conservativeExpectedValue: 0.5 }), leg("b", 1.91, { conservativeExpectedValue: 0.4 }),
      leg("b", 2.3, { market: "BTTS", selection: "YES", conservativeExpectedValue: 0.35 }),
      leg("c", 2.05, { conservativeExpectedValue: 0.3 }), leg("d", 4.75, { conservativeExpectedValue: 0.25 }),
      leg("e", 2.2, { conservativeExpectedValue: 0.2 }), leg("f", 2.4, { conservativeExpectedValue: 0.15 }),
      leg("g", 2.1, { conservativeExpectedValue: 0.1 }), leg("h", 2.6, { conservativeExpectedValue: 0.08 }),
      leg("i", 2.3, { conservativeExpectedValue: 0.05 })
    ];
    const drafts = buildTickets(candidates, ["preferred"], now);
    expect(drafts.map((draft) => draft.tier.key)).toEqual(["STANDARD", "VALUE", "HIGH"]);
    const used = fixturesOf(drafts);
    expect(new Set(used).size).toBe(used.length);
    // STANDARD is built first and so keeps the best-EV legs.
    expect(drafts[0]!.legs.map((item) => item.fixtureId)).toEqual(["a", "b"]);
    for (const draft of drafts) expect(draft.relaxed).toBe(false);
  });

  it("skips a tier rather than overlap when there are too few fixtures", () => {
    const drafts = buildTickets([leg("a", 2), leg("b", 2.5), leg("c", 2.2), leg("d", 2.1)], ["preferred"], now);
    expect(drafts.map((draft) => draft.tier.key)).toEqual(["STANDARD"]);
  });

  it("does not relax confidence just to find unused fixtures", () => {
    // VALUE fits at 70 on the full pool (a*b*x = 13.75) but STANDARD takes a, b. The 65-confidence
    // legs would give VALUE fresh fixtures, yet it only needs them because of the exclusion -> skipped.
    // HIGH needs 65 even on the full pool, so relaxing it is legitimate.
    const candidates = [
      leg("a", 2.5), leg("b", 2.5), leg("x", 2.2), leg("c", 2.2, { confidenceScore: 65 }), leg("d", 2.2, { confidenceScore: 65 }), leg("e", 2.2, { confidenceScore: 65 })
    ];
    const drafts = buildTickets(candidates, ["preferred"], now);
    expect(drafts.map((draft) => draft.tier.key)).toEqual(["STANDARD", "HIGH"]);
    expect(drafts[1]!.relaxed).toBe(true);
    const used = fixturesOf(drafts);
    expect(new Set(used).size).toBe(used.length);
  });

  it("still relaxes when the tier needs it regardless of overlap", () => {
    const candidates = [leg("a", 2.5), leg("b", 2.5), leg("c", 2.2, { confidenceScore: 65 }), leg("d", 2.2, { confidenceScore: 65 }), leg("e", 2.2, { confidenceScore: 65 })];
    const drafts = buildTickets(candidates, ["preferred"], now, { skipTiers: ["STANDARD"] });
    // Without STANDARD, VALUE (10-20) can't be made from a, b alone at 70 -- relaxing is genuine.
    const value = drafts.find((draft) => draft.tier.key === "VALUE");
    expect(value?.relaxed).toBe(true);
    expect(value?.confidenceThreshold).toBe(65);
  });

  it("honours reserved fixtures and skipped tiers from tickets already live", () => {
    const candidates = ["a", "b", "c", "d", "e", "f", "g"].map((id) => leg(id, 2.3));
    const drafts = buildTickets(candidates, ["preferred"], now, { skipTiers: ["STANDARD"], reservedFixtureIds: ["a", "b"] });
    expect(drafts.some((draft) => draft.tier.key === "STANDARD")).toBe(false);
    expect(fixturesOf(drafts)).not.toContain("a");
    expect(fixturesOf(drafts)).not.toContain("b");
    expect(drafts.map((draft) => draft.tier.key)).toContain("VALUE");
  });
});

describe("republishing around live tickets", () => {
  it("keeps a locked tier and never reuses its fixtures", () => {
    const candidates = ["a", "b", "c", "d", "e", "f", "g"].map((id) => leg(id, 2.3));
    const drafts = buildTicketsAround(candidates, ["preferred"], now, [{ tier: "STANDARD", locked: true, fixtureIds: ["a", "b"] }]);
    expect(drafts.map((draft) => draft.tier.key)).toEqual(["VALUE"]);
    expect(fixturesOf(drafts)).toEqual(["c", "d", "e"]);
  });

  it("lets an unlocked tier's replacement reuse that tier's own fixtures", () => {
    const drafts = buildTicketsAround([leg("a", 2), leg("b", 2.5)], ["preferred"], now, [{ tier: "STANDARD", locked: false, fixtureIds: ["a", "b"] }]);
    expect(drafts.map((draft) => draft.tier.key)).toEqual(["STANDARD"]);
  });

  it("reserves an unlocked ticket's fixtures when this run can't replace it", () => {
    // Pass 1 gives STANDARD c, d, which leaves VALUE unbuildable, so the live VALUE (c, d, e) stays.
    // Pass 2 must then rebuild STANDARD without c, d -- from x, y.
    const candidates = [leg("c", 2.5, { conservativeExpectedValue: 0.3 }), leg("d", 2.5, { conservativeExpectedValue: 0.3 }), leg("x", 2.2), leg("y", 2.3)];
    const drafts = buildTicketsAround(candidates, ["preferred"], now, [{ tier: "VALUE", locked: false, fixtureIds: ["c", "d", "e"] }]);
    expect(drafts.map((draft) => draft.tier.key)).toEqual(["STANDARD"]);
    expect(fixturesOf(drafts).sort()).toEqual(["x", "y"]);
  });
});
