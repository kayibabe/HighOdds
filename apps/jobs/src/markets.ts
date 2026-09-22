import type { SupportedMarket } from "@highodds/core";

/**
 * API-Football bet market names, matched case-insensitively. Only the 2.5 goal
 * line is supported; other lines are ignored. Verified against live payloads
 * (fixture 1557409 Brighton v Arsenal, and fixture 1570411 Real Madrid v
 * Villarreal across 6 bookmakers including Pinnacle/SBO, which don't always
 * carry the 2.5 line) -- see apps/jobs/test/markets.test.ts and README.md.
 */
export function normalizeMarket(providerBetName: string): SupportedMarket | null {
  const name = providerBetName.trim().toLowerCase();
  if (name === "match winner") return "MATCH_WINNER";
  if (name === "goals over/under") return "TOTAL_GOALS";
  if (name === "both teams score" || name === "both teams to score") return "BTTS";
  return null;
}

export function normalizeSelection(market: SupportedMarket, providerValue: string): string | null {
  const value = providerValue.trim().toLowerCase();
  if (market === "MATCH_WINNER") {
    if (value === "home") return "HOME";
    if (value === "draw") return "DRAW";
    if (value === "away") return "AWAY";
    return null;
  }
  if (market === "TOTAL_GOALS") {
    if (value === "over 2.5") return "OVER_2_5";
    if (value === "under 2.5") return "UNDER_2_5";
    return null;
  }
  if (market === "BTTS") {
    if (value === "yes") return "YES";
    if (value === "no") return "NO";
    return null;
  }
  return null;
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
