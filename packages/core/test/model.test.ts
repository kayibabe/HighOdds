import { describe, expect, it } from "vitest";
import { dixonColesDistribution, leagueEligibility } from "../src/model.js";

describe("model safeguards", () => {
  it("keeps outcome probability mass normalized", () => {
    const result = dixonColesDistribution(1.4, 1.1);
    expect(result.homeWin + result.draw + result.awayWin).toBeCloseTo(1, 6);
  });
  it("rejects fixtures with insufficient history", () => {
    const kickoff = new Date("2026-09-20T12:00:00Z");
    const matches = Array.from({ length: 49 }, (_, index) => ({ kickoff: new Date(kickoff.getTime() - (index + 1) * 86_400_000), homeTeamId: "A", awayTeamId: "B", homeGoals: 1, awayGoals: 0 }));
    expect(leagueEligibility(matches, kickoff, "A", "B").reason).toBe("LEAGUE_HISTORY_BELOW_50");
  });
});
