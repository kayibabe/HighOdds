export interface EvidenceForecast {
  fixtureId: string;
  competitionId: string;
  market: string;
  selection: string;
  method: string;
  probability: number;
  forecastAt: Date;
  trainedUntil: Date;
  kickoff: Date;
  resultRecordedAt: Date;
  hit: boolean;
}

export const EVIDENCE_WINDOW_DAYS = 180;

/** One eligible forecast per match; compare within a fixed ten percentage point band. */
export function forecastEvidence(rows: EvidenceForecast[], target: Pick<EvidenceForecast,
  "fixtureId" | "competitionId" | "market" | "selection" | "method" | "probability" | "forecastAt">) {
  const lower = Math.min(0.9, Math.floor(target.probability * 10) / 10);
  const upper = lower + 0.1;
  const since = new Date(target.forecastAt.getTime() - EVIDENCE_WINDOW_DAYS * 86_400_000);
  const latest = new Map<string, EvidenceForecast>();
  for (const row of rows) {
    if (row.fixtureId === target.fixtureId || row.competitionId !== target.competitionId || row.market !== target.market ||
      row.selection !== target.selection || row.method !== target.method || row.kickoff < since ||
      row.kickoff >= target.forecastAt || row.resultRecordedAt >= target.forecastAt ||
      row.forecastAt >= row.kickoff || row.forecastAt >= target.forecastAt || row.trainedUntil > row.forecastAt ||
      !Number.isFinite(row.probability) || row.probability < 0 || row.probability > 1) continue;
    const current = latest.get(row.fixtureId);
    if (!current || row.forecastAt > current.forecastAt) latest.set(row.fixtureId, row);
  }
  const comparable = [...latest.values()].filter((row) => row.probability >= lower && (row.probability < upper || (lower === 0.9 && row.probability === 1)));
  const matches = comparable.length;
  const wins = comparable.filter((row) => row.hit).length;
  const observed = matches ? wins / matches : null;
  const predicted = matches ? comparable.reduce((sum, row) => sum + row.probability, 0) / matches : null;
  // Wilson interval remains informative for small samples and all-win/all-loss cohorts.
  const z = 1.96;
  const denominator = 1 + z * z / (matches || 1);
  const centre = observed === null ? null : (observed + z * z / (2 * matches)) / denominator;
  const margin = observed === null ? null : z * Math.sqrt(observed * (1 - observed) / matches + z * z / (4 * matches * matches)) / denominator;
  return { lower, upper, matches, wins, observed, predicted,
    interval: centre === null || margin === null ? null : { lower: centre - margin, upper: centre + margin },
    gap: observed === null || predicted === null ? null : observed - predicted };
}
