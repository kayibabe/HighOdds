import { describe, expect, it } from "vitest";
import { normalizeMarket, normalizeSelection, resolveSelection } from "../src/markets.js";
import fixture from "./fixtures/odds-brighton-arsenal.json" with { type: "json" };

type FixtureBet = { name: string; values: Array<{ value: string; odd: string }> };
type FixtureBookmaker = { name: string; bets: FixtureBet[] };

const bookmakers = fixture.bookmakers as FixtureBookmaker[];
const byName = (name: string) => bookmakers.find((b) => b.name === name)!;

describe("normalizeMarket against a live-captured API-Football payload (fixture 1557409, Brighton 3-0 Arsenal)", () => {
  it("maps the three supported bet names exactly as returned by real bookmakers", () => {
    expect(normalizeMarket("Match Winner")).toBe("MATCH_WINNER");
    expect(normalizeMarket("Goals Over/Under")).toBe("TOTAL_GOALS");
    expect(normalizeMarket("Both Teams Score")).toBe("BTTS");
  });

  it("rejects every other real bet name seen in the payload, including near-miss variants", () => {
    const unsupported = ["First Half Winner", "Goals Over/Under First Half", "Goals Over/Under - Second Half"];
    for (const name of unsupported) expect(normalizeMarket(name)).toBeNull();
  });

  it("William Hill never offers a full-match Goals Over/Under for this fixture; none of its real bet names normalize to TOTAL_GOALS", () => {
    const williamHill = byName("William Hill");
    const totalGoalsBets = williamHill.bets.filter((bet) => normalizeMarket(bet.name) === "TOTAL_GOALS");
    expect(totalGoalsBets).toHaveLength(0);
  });
});

describe("normalizeSelection against real bookmaker value strings", () => {
  it("accepts Home/Draw/Away for MATCH_WINNER from every real bookmaker in the payload", () => {
    for (const bookmaker of bookmakers) {
      const matchWinner = bookmaker.bets.find((bet) => bet.name === "Match Winner")!;
      for (const { value } of matchWinner.values) {
        expect(normalizeSelection("MATCH_WINNER", value)).not.toBeNull();
      }
    }
  });

  it("accepts only the exact 2.5 line out of Marathonbet's real 26-value Asian-line Goals Over/Under sheet", () => {
    const marathonbet = byName("Marathonbet");
    const goalsOverUnder = marathonbet.bets.find((bet) => bet.name === "Goals Over/Under")!;
    const accepted = goalsOverUnder.values.filter((v) => normalizeSelection("TOTAL_GOALS", v.value) !== null);
    expect(accepted.map((v) => v.value).sort()).toEqual(["Over 2.5", "Under 2.5"]);
    expect(normalizeSelection("TOTAL_GOALS", "Over 2.5")).toBe("OVER_2_5");
    expect(normalizeSelection("TOTAL_GOALS", "Under 2.5")).toBe("UNDER_2_5");
  });

  it("accepts Yes/No for BTTS from every real bookmaker in the payload", () => {
    for (const bookmaker of bookmakers) {
      const btts = bookmaker.bets.find((bet) => bet.name === "Both Teams Score")!;
      expect(normalizeSelection("BTTS", btts.values.find((v) => v.value === "Yes")!.value)).toBe("YES");
      expect(normalizeSelection("BTTS", btts.values.find((v) => v.value === "No")!.value)).toBe("NO");
    }
  });
});

describe("resolveSelection against the real final score (Brighton 3, Arsenal 0)", () => {
  const { homeGoals, awayGoals } = fixture.result;

  it("settles MATCH_WINNER legs correctly", () => {
    expect(resolveSelection("MATCH_WINNER", "HOME", homeGoals, awayGoals)).toBe("WIN");
    expect(resolveSelection("MATCH_WINNER", "DRAW", homeGoals, awayGoals)).toBe("LOSS");
    expect(resolveSelection("MATCH_WINNER", "AWAY", homeGoals, awayGoals)).toBe("LOSS");
  });

  it("settles TOTAL_GOALS legs correctly (3 total goals clears the 2.5 line)", () => {
    expect(resolveSelection("TOTAL_GOALS", "OVER_2_5", homeGoals, awayGoals)).toBe("WIN");
    expect(resolveSelection("TOTAL_GOALS", "UNDER_2_5", homeGoals, awayGoals)).toBe("LOSS");
  });

  it("settles BTTS legs correctly (away side failed to score)", () => {
    expect(resolveSelection("BTTS", "YES", homeGoals, awayGoals)).toBe("LOSS");
    expect(resolveSelection("BTTS", "NO", homeGoals, awayGoals)).toBe("WIN");
  });
});
