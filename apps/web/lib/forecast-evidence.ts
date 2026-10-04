import { db } from "@highodds/db";
import { EVIDENCE_WINDOW_DAYS, resolveSelection, type EvidenceForecast } from "@highodds/core";

export type EvidenceTarget = Pick<EvidenceForecast, "fixtureId" | "competitionId" | "forecastAt">;

/** Batch history for either Today or Research; the core scorer applies each forecast's own cutoff. */
export async function loadForecastEvidence(targets: EvidenceTarget[]): Promise<EvidenceForecast[]> {
  if (!targets.length) return [];
  const times = targets.map((target) => target.forecastAt.getTime());
  const end = new Date(Math.max(...times));
  const start = new Date(Math.min(...times) - EVIDENCE_WINDOW_DAYS * 86_400_000);
  const fixtures = await db.fixture.findMany({
    where: { competitionId: { in: [...new Set(targets.map((target) => target.competitionId))] }, status: "FINISHED",
      kickoff: { gte: start, lt: end }, receivedAt: { lt: end },
      homeGoals: { not: null }, awayGoals: { not: null }, predictions: { some: {} } },
    include: { predictions: { orderBy: { asOfAt: "desc" }, include: { market: true, modelRun: true } } }
  });
  return fixtures.flatMap((fixture) => fixture.predictions.flatMap((row) => {
    const market = row.market.normalizedKey ?? row.market.name;
    const outcome = resolveSelection(market, row.selection, fixture.homeGoals!, fixture.awayGoals!);
    if (outcome !== "WIN" && outcome !== "LOSS") return [];
    return [{ fixtureId: fixture.id, competitionId: fixture.competitionId, market, selection: row.selection,
      method: row.modelRun.method, probability: Number(row.probability), forecastAt: row.asOfAt,
      trainedUntil: row.modelRun.trainedUntil, kickoff: fixture.kickoff, resultRecordedAt: fixture.receivedAt, hit: outcome === "WIN" }];
  }));
}
