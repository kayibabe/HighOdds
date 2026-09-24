import { describe, expect, it } from "vitest";
import { attributeTicket, evidenceLegOutcome, legOutcome, parseSettlementEvidence, type LegOutcome } from "../src/settlement.js";

const finished = (homeGoals: number, awayGoals: number) => ({ status: "FINISHED", homeGoals, awayGoals });
const legs = (...outcomes: LegOutcome[]) => outcomes.map((outcome, index) => ({ id: `leg${index}`, outcome }));

describe("legOutcome", () => {
  it("resolves finished fixtures from the final score", () => {
    expect(legOutcome("MATCH_WINNER", "HOME", finished(2, 1))).toBe("WIN");
    expect(legOutcome("TOTAL_GOALS", "OVER_2_5", finished(1, 1))).toBe("LOSS");
    expect(legOutcome("BTTS", "NO", finished(0, 3))).toBe("WIN");
  });

  it("voids postponed and cancelled fixtures and keeps live ones pending", () => {
    expect(legOutcome("MATCH_WINNER", "HOME", { status: "POSTPONED", homeGoals: null, awayGoals: null })).toBe("VOID");
    expect(legOutcome("MATCH_WINNER", "HOME", { status: "CANCELLED", homeGoals: null, awayGoals: null })).toBe("VOID");
    expect(legOutcome("MATCH_WINNER", "HOME", { status: "LIVE", homeGoals: 1, awayGoals: 0 })).toBe("PENDING");
    expect(legOutcome("MATCH_WINNER", "HOME", { status: "SCHEDULED", homeGoals: null, awayGoals: null })).toBe("PENDING");
  });

  it("flags a finished fixture it cannot resolve instead of calling it a loss", () => {
    expect(legOutcome("MATCH_WINNER", "HOME", { status: "FINISHED", homeGoals: null, awayGoals: null })).toBe("UNRESOLVED");
    expect(legOutcome("CORNERS", "OVER_9_5", finished(1, 0))).toBe("UNRESOLVED");
  });
});

describe("settlement evidence", () => {
  it("parses the rows settleResults writes and drops malformed ones", () => {
    const rows = parseSettlementEvidence([
      { fixtureId: "f1", marketKey: "MATCH_WINNER", selection: "HOME", status: "FINISHED", homeGoals: 2, awayGoals: 0, result: "WIN" },
      { fixtureId: "f2", marketKey: "BTTS", selection: "YES", status: "POSTPONED", homeGoals: null, awayGoals: null, result: null },
      { fixtureId: "f3", marketKey: "BTTS", selection: "YES", status: "FINISHED", homeGoals: "2", awayGoals: 0, result: "WIN" },
      null
    ]);
    expect(rows.map((row) => [row.fixtureId, evidenceLegOutcome(row)])).toEqual([["f1", "WIN"], ["f2", "VOID"]]);
    expect(parseSettlementEvidence({ not: "an array" })).toEqual([]);
  });
});

describe("attributeTicket", () => {
  it("credits every leg on a win", () => {
    const result = attributeTicket("WIN", legs("WIN", "WIN", "WIN"));
    expect(result.decisiveLegIds).toEqual(["leg0", "leg1", "leg2"]);
    expect(result.summary).toBe("All 3 legs won.");
  });

  it("blames only the losing legs on a loss", () => {
    const result = attributeTicket("LOSS", legs("WIN", "LOSS", "WIN", "LOSS"));
    expect(result.decisiveLegIds).toEqual(["leg1", "leg3"]);
    expect(result.summary).toBe("Lost on 2 of 4 legs; 2 won.");
  });

  it("counts an unresolvable leg as part of a loss and says so", () => {
    const result = attributeTicket("LOSS", legs("WIN", "UNRESOLVED"));
    expect(result.decisiveLegIds).toEqual(["leg1"]);
    expect(result.summary).toContain("could not be resolved");
  });

  it("attributes a void to the postponed or cancelled legs even when another leg lost", () => {
    const result = attributeTicket("VOID", legs("LOSS", "VOID", "WIN"));
    expect(result.decisiveLegIds).toEqual(["leg1"]);
    expect(result.summary).toMatch(/^Voided by 1 postponed or cancelled leg;/);
  });

  it("previews an unsettled ticket that is already beaten", () => {
    const result = attributeTicket("PENDING", legs("WIN", "LOSS", "PENDING"));
    expect(result.decisiveLegIds).toEqual(["leg1"]);
    expect(result.summary).toMatch(/^Already beaten by 1 losing leg; 1 won, 1 still to play/);
  });

  it("reports progress on an unsettled ticket with nothing decided yet", () => {
    const result = attributeTicket("PENDING", legs("WIN", "PENDING", "PENDING"));
    expect(result.decisiveLegIds).toEqual([]);
    expect(result.summary).toBe("1 of 3 legs won so far; 2 pending.");
  });
});
