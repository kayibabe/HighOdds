import { describe, expect, it } from "vitest";
import { buildTickets, buildTicketsAround } from "../src/tickets.js";
import type { CandidateLeg, TicketDraft } from "../src/types.js";

const now = new Date("2026-09-20T06:00:00Z");
function leg(fixtureId: string, odds: number, overrides: Partial<CandidateLeg> = {}): CandidateLeg { return { fixtureId, bookmakerId: "preferred", market: "MATCH_WINNER", selection: "HOME", decimalOdds: odds, capturedAt: now, kickoff: new Date("2026-09-20T12:00:00Z"), modelProbability: 0.6, consensusProbability: 0.5, conservativeExpectedValue: 0.1, confidenceScore: 70, leagueId: fixtureId, ...overrides }; }
const fixturesOf = (drafts: TicketDraft[]) => drafts.flatMap((draft) => draft.legs.map((item) => item.fixtureId));

describe("ticket construction", () => {
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
