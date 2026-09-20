export interface CompletedMatch {
  kickoff: Date;
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number;
  awayGoals: number;
}

export interface LeagueEligibility {
  eligible: boolean;
  reason?: string;
  homeMatches: number;
  awayMatches: number;
  leagueMatches: number;
}

export interface GoalDistribution {
  homeWin: number;
  draw: number;
  awayWin: number;
  over25: number;
  under25: number;
  bttsYes: number;
  bttsNo: number;
}

const DAYS_365 = 365 * 24 * 60 * 60 * 1000;

/** Enforces the evidence floor before a fixture can be model-scored. */
export function leagueEligibility(matches: CompletedMatch[], fixtureKickoff: Date, homeTeamId: string, awayTeamId: string): LeagueEligibility {
  const lowerBound = fixtureKickoff.getTime() - DAYS_365;
  const eligible = matches.filter((match) => match.kickoff.getTime() < fixtureKickoff.getTime() && match.kickoff.getTime() >= lowerBound);
  const homeMatches = eligible.filter((match) => match.homeTeamId === homeTeamId || match.awayTeamId === homeTeamId).length;
  const awayMatches = eligible.filter((match) => match.homeTeamId === awayTeamId || match.awayTeamId === awayTeamId).length;
  if (eligible.length < 50) return { eligible: false, reason: "LEAGUE_HISTORY_BELOW_50", homeMatches, awayMatches, leagueMatches: eligible.length };
  if (homeMatches < 8 || awayMatches < 8) return { eligible: false, reason: "TEAM_HISTORY_BELOW_8", homeMatches, awayMatches, leagueMatches: eligible.length };
  return { eligible: true, homeMatches, awayMatches, leagueMatches: eligible.length };
}

function poisson(k: number, lambda: number): number {
  let factorial = 1;
  for (let i = 2; i <= k; i += 1) factorial *= i;
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial;
}

/**
 * Compact Dixon-Coles-compatible scoreline projection. The rho adjustment is
 * intentionally limited to low scorelines; fitted attack/defence parameters
 * belong in the persisted model artifact, not this pure scoring function.
 */
export function dixonColesDistribution(homeExpectedGoals: number, awayExpectedGoals: number, rho = -0.05, maxGoals = 10): GoalDistribution {
  if (homeExpectedGoals <= 0 || awayExpectedGoals <= 0) throw new Error("Expected goals must be positive");
  let homeWin = 0; let draw = 0; let awayWin = 0; let over25 = 0; let bttsYes = 0;
  for (let home = 0; home <= maxGoals; home += 1) {
    for (let away = 0; away <= maxGoals; away += 1) {
      let adjustment = 1;
      if (home === 0 && away === 0) adjustment = 1 - homeExpectedGoals * awayExpectedGoals * rho;
      if (home === 0 && away === 1) adjustment = 1 + homeExpectedGoals * rho;
      if (home === 1 && away === 0) adjustment = 1 + awayExpectedGoals * rho;
      if (home === 1 && away === 1) adjustment = 1 - rho;
      const probability = poisson(home, homeExpectedGoals) * poisson(away, awayExpectedGoals) * adjustment;
      if (home > away) homeWin += probability; else if (home === away) draw += probability; else awayWin += probability;
      if (home + away >= 3) over25 += probability;
      if (home > 0 && away > 0) bttsYes += probability;
    }
  }
  const total = homeWin + draw + awayWin;
  return { homeWin: homeWin / total, draw: draw / total, awayWin: awayWin / total, over25: over25 / total, under25: 1 - over25 / total, bttsYes: bttsYes / total, bttsNo: 1 - bttsYes / total };
}
