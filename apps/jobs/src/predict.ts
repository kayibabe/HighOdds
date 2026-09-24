import { db } from "@highodds/db";
import { dixonColesDistribution, expectedGoals, HISTORY_LOOKBACK_DAYS, leagueEligibility, SELECTION_WINDOW_HOURS, type TeamStrengths, type CompletedMatch } from "@highodds/core";

const SELECTION_WINDOW_MS = SELECTION_WINDOW_HOURS * 60 * 60 * 1000;
const HISTORY_LOOKBACK_MS = HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

const MARKET_SELECTIONS: Record<string, Array<{ selection: string; pick: (dist: ReturnType<typeof dixonColesDistribution>) => number }>> = {
  MATCH_WINNER: [
    { selection: "HOME", pick: (d) => d.homeWin },
    { selection: "DRAW", pick: (d) => d.draw },
    { selection: "AWAY", pick: (d) => d.awayWin }
  ],
  TOTAL_GOALS: [
    { selection: "OVER_2_5", pick: (d) => d.over25 },
    { selection: "UNDER_2_5", pick: (d) => d.under25 }
  ],
  BTTS: [
    { selection: "YES", pick: (d) => d.bttsYes },
    { selection: "NO", pick: (d) => d.bttsNo }
  ]
};

export async function generatePredictions(now: Date): Promise<{ predicted: number; skipped: number }> {
  const windowEnd = new Date(now.getTime() + SELECTION_WINDOW_MS);
  const fixtures = await db.fixture.findMany({
    where: { status: "SCHEDULED", kickoff: { gte: now, lte: windowEnd } },
    select: { id: true, competitionId: true, homeTeamId: true, awayTeamId: true, kickoff: true }
  });

  const markets = await db.market.findMany({ where: { normalizedKey: { not: null } }, select: { id: true, normalizedKey: true } });
  const marketByKey = new Map(markets.map((market) => [market.normalizedKey!, market.id]));

  let predicted = 0; let skipped = 0;
  const modelRunCache = new Map<string, { id: string; strengths: TeamStrengths } | null>();

  for (const fixture of fixtures) {
    let modelRun = modelRunCache.get(fixture.competitionId);
    if (modelRun === undefined) {
      const latest = await db.modelRun.findFirst({ where: { competitionId: fixture.competitionId }, orderBy: { createdAt: "desc" } });
      modelRun = latest ? { id: latest.id, strengths: latest.artifact as unknown as TeamStrengths } : null;
      modelRunCache.set(fixture.competitionId, modelRun);
    }
    if (!modelRun) { skipped += 1; continue; }
    if (!modelRun.strengths.teams[fixture.homeTeamId] || !modelRun.strengths.teams[fixture.awayTeamId]) { skipped += 1; continue; }

    const history = await db.fixture.findMany({
      where: { competitionId: fixture.competitionId, status: "FINISHED", kickoff: { gte: new Date(fixture.kickoff.getTime() - HISTORY_LOOKBACK_MS), lt: fixture.kickoff }, homeGoals: { not: null }, awayGoals: { not: null } },
      select: { kickoff: true, homeTeamId: true, awayTeamId: true, homeGoals: true, awayGoals: true }
    });
    const matches: CompletedMatch[] = history.map((h) => ({ kickoff: h.kickoff, homeTeamId: h.homeTeamId, awayTeamId: h.awayTeamId, homeGoals: h.homeGoals!, awayGoals: h.awayGoals! }));
    const eligibility = leagueEligibility(matches, fixture.kickoff, fixture.homeTeamId, fixture.awayTeamId);
    if (!eligibility.eligible) { skipped += 1; continue; }

    const goals = expectedGoals(fixture.homeTeamId, fixture.awayTeamId, modelRun.strengths);
    const distribution = dixonColesDistribution(goals.home, goals.away);

    for (const [marketKey, selections] of Object.entries(MARKET_SELECTIONS)) {
      const marketId = marketByKey.get(marketKey);
      if (!marketId) continue;
      for (const { selection, pick } of selections) {
        const existing = await db.prediction.findFirst({ where: { fixtureId: fixture.id, marketId, selection, modelRunId: modelRun.id } });
        if (existing) continue;
        await db.prediction.create({ data: { fixtureId: fixture.id, marketId, selection, probability: pick(distribution), modelRunId: modelRun.id, asOfAt: now } });
        predicted += 1;
      }
    }
  }
  return { predicted, skipped };
}
