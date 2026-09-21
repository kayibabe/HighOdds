import type { CompletedMatch } from "./model.js";

export interface TeamStrengths {
  homeAdvantage: number;
  leagueAverageGoals: number;
  teams: Record<string, { attack: number; defense: number; matchCount: number }>;
}

/**
 * Iterative proportional fitting for a Dixon-Coles-compatible Poisson model:
 * converges attack[home]*defense[away]*homeAdvantage*leagueAvg ~= observed home goals,
 * and attack[away]*defense[home]*leagueAvg ~= observed away goals.
 */
export function fitTeamStrengths(matches: CompletedMatch[], iterations = 30): TeamStrengths {
  if (matches.length === 0) throw new Error("At least one completed match is required to fit strengths");
  const teamIds = new Set<string>();
  for (const match of matches) { teamIds.add(match.homeTeamId); teamIds.add(match.awayTeamId); }

  const totalGoals = matches.reduce((sum, match) => sum + match.homeGoals + match.awayGoals, 0);
  const leagueAverageGoals = totalGoals / (matches.length * 2);

  const totalHomeGoals = matches.reduce((sum, match) => sum + match.homeGoals, 0);
  const totalAwayGoals = matches.reduce((sum, match) => sum + match.awayGoals, 0);
  let homeAdvantage = totalAwayGoals > 0 ? totalHomeGoals / totalAwayGoals : 1;

  const attack: Record<string, number> = {};
  const defense: Record<string, number> = {};
  const matchCount: Record<string, number> = {};
  for (const teamId of teamIds) { attack[teamId] = 1; defense[teamId] = 1; matchCount[teamId] = 0; }
  for (const match of matches) { matchCount[match.homeTeamId]! += 1; matchCount[match.awayTeamId]! += 1; }

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const attackNumerator: Record<string, number> = {};
    const attackDenominator: Record<string, number> = {};
    for (const teamId of teamIds) { attackNumerator[teamId] = 0; attackDenominator[teamId] = 0; }
    for (const match of matches) {
      attackNumerator[match.homeTeamId]! += match.homeGoals;
      attackDenominator[match.homeTeamId]! += leagueAverageGoals * defense[match.awayTeamId]! * homeAdvantage;
      attackNumerator[match.awayTeamId]! += match.awayGoals;
      attackDenominator[match.awayTeamId]! += leagueAverageGoals * defense[match.homeTeamId]!;
    }
    for (const teamId of teamIds) {
      if (attackDenominator[teamId]! > 0) attack[teamId] = attackNumerator[teamId]! / attackDenominator[teamId]!;
    }

    const defenseNumerator: Record<string, number> = {};
    const defenseDenominator: Record<string, number> = {};
    for (const teamId of teamIds) { defenseNumerator[teamId] = 0; defenseDenominator[teamId] = 0; }
    for (const match of matches) {
      defenseNumerator[match.awayTeamId]! += match.homeGoals;
      defenseDenominator[match.awayTeamId]! += leagueAverageGoals * attack[match.homeTeamId]! * homeAdvantage;
      defenseNumerator[match.homeTeamId]! += match.awayGoals;
      defenseDenominator[match.homeTeamId]! += leagueAverageGoals * attack[match.awayTeamId]!;
    }
    for (const teamId of teamIds) {
      if (defenseDenominator[teamId]! > 0) defense[teamId] = defenseNumerator[teamId]! / defenseDenominator[teamId]!;
    }

    let expectedHomeUnscaled = 0;
    for (const match of matches) {
      expectedHomeUnscaled += leagueAverageGoals * attack[match.homeTeamId]! * defense[match.awayTeamId]!;
    }
    if (expectedHomeUnscaled > 0) homeAdvantage = totalHomeGoals / expectedHomeUnscaled;
  }

  const teams: TeamStrengths["teams"] = {};
  for (const teamId of teamIds) teams[teamId] = { attack: attack[teamId]!, defense: defense[teamId]!, matchCount: matchCount[teamId]! };
  return { homeAdvantage, leagueAverageGoals, teams };
}

export function expectedGoals(homeTeamId: string, awayTeamId: string, strengths: TeamStrengths): { home: number; away: number } {
  const home = strengths.teams[homeTeamId];
  const away = strengths.teams[awayTeamId];
  if (!home || !away) throw new Error("Both teams must be present in the fitted strengths");
  return {
    home: Math.max(0.05, strengths.leagueAverageGoals * home.attack * away.defense * strengths.homeAdvantage),
    away: Math.max(0.05, strengths.leagueAverageGoals * away.attack * home.defense)
  };
}
