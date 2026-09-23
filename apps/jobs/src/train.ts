import { db } from "@highodds/db";
import { fitTeamStrengths, type CompletedMatch } from "@highodds/core";

const LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;
const MIN_MATCHES = 50;

export class NoTrainingDataError extends Error {
  constructor(skipped: number) {
    super(`TRAIN_MODEL trained 0 competitions: all ${skipped} had fewer than ${MIN_MATCHES} FINISHED fixtures in the last 365 days. Run \`npm run jobs:backfill-fixtures --workspace=@highodds/jobs\` against this database.`);
    this.name = "NoTrainingDataError";
  }
}

export function assertTrainedAny(result: { trained: number; skipped: number }): void {
  if (result.trained === 0) throw new NoTrainingDataError(result.skipped);
}

export async function trainModel(now: Date): Promise<{ trained: number; skipped: number }> {
  const lookbackStart = new Date(now.getTime() - LOOKBACK_MS);
  const competitions = await db.competition.findMany({ select: { id: true } });
  let trained = 0; let skipped = 0;

  for (const competition of competitions) {
    const fixtures = await db.fixture.findMany({
      where: { competitionId: competition.id, status: "FINISHED", kickoff: { gte: lookbackStart, lt: now }, homeGoals: { not: null }, awayGoals: { not: null } },
      select: { kickoff: true, homeTeamId: true, awayTeamId: true, homeGoals: true, awayGoals: true }
    });
    if (fixtures.length < MIN_MATCHES) { skipped += 1; continue; }
    const matches: CompletedMatch[] = fixtures.map((fixture) => ({
      kickoff: fixture.kickoff, homeTeamId: fixture.homeTeamId, awayTeamId: fixture.awayTeamId,
      homeGoals: fixture.homeGoals!, awayGoals: fixture.awayGoals!
    }));
    const strengths = fitTeamStrengths(matches);
    await db.modelRun.create({
      data: {
        competitionId: competition.id,
        version: now.toISOString(),
        method: "dixon-coles-ipf-v1",
        trainedUntil: now,
        artifact: strengths as unknown as object
      }
    });
    trained += 1;
  }
  return { trained, skipped };
}
