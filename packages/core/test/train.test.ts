import { describe, expect, it } from "vitest";
import { expectedGoals, fitTeamStrengths } from "../src/train.js";
import type { CompletedMatch } from "../src/model.js";

function match(kickoff: string, home: string, away: string, homeGoals: number, awayGoals: number): CompletedMatch {
  return { kickoff: new Date(kickoff), homeTeamId: home, awayTeamId: away, homeGoals, awayGoals };
}

describe("fitTeamStrengths", () => {
  it("gives the consistently higher-scoring team a stronger attack rating", () => {
    const matches: CompletedMatch[] = [];
    for (let round = 0; round < 10; round += 1) {
      matches.push(match(`2026-01-${String(round + 1).padStart(2, "0")}T12:00:00Z`, "strong", "weak", 3, 0));
      matches.push(match(`2026-02-${String(round + 1).padStart(2, "0")}T12:00:00Z`, "weak", "strong", 0, 2));
      matches.push(match(`2026-03-${String(round + 1).padStart(2, "0")}T12:00:00Z`, "strong", "mid", 2, 1));
      matches.push(match(`2026-04-${String(round + 1).padStart(2, "0")}T12:00:00Z`, "mid", "weak", 1, 1));
    }
    const strengths = fitTeamStrengths(matches);
    expect(strengths.teams.strong!.attack).toBeGreaterThan(strengths.teams.weak!.attack);
    expect(strengths.teams.weak!.defense).toBeGreaterThan(strengths.teams.strong!.defense);
    const projection = expectedGoals("strong", "weak", strengths);
    expect(projection.home).toBeGreaterThan(projection.away);
  });

  it("rejects an empty match list", () => {
    expect(() => fitTeamStrengths([])).toThrow();
  });
});
