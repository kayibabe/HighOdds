import { strongestPrediction, type StoredPrediction } from "./settlement.js";

export const PROBABILITY_THRESHOLDS = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95] as const;
export const MODEL_PICK_FILTERS = [
  { value: "ALL", label: "All model picks", market: null, selection: null },
  { value: "OVER_2_5", label: "Over 2.5", market: "TOTAL_GOALS", selection: "OVER_2_5" },
  { value: "UNDER_2_5", label: "Under 2.5", market: "TOTAL_GOALS", selection: "UNDER_2_5" },
  { value: "HOME", label: "Home win", market: "MATCH_WINNER", selection: "HOME" },
  { value: "DRAW", label: "Draw", market: "MATCH_WINNER", selection: "DRAW" },
  { value: "AWAY", label: "Away win", market: "MATCH_WINNER", selection: "AWAY" },
  { value: "BTTS_YES", label: "BTTS: Yes", market: "BTTS", selection: "YES" },
  { value: "BTTS_NO", label: "BTTS: No", market: "BTTS", selection: "NO" }
] as const;
export function modelPickFilter(value: string | string[] | undefined) {
  return MODEL_PICK_FILTERS.find((filter) => filter.value === value) ?? MODEL_PICK_FILTERS[0];
}
export function probabilityThreshold(value: string | string[] | undefined): number {
  const parsed = typeof value === "string" ? Number(value) : NaN;
  return PROBABILITY_THRESHOLDS.some((threshold) => threshold === parsed) ? parsed : 90;
}

/** Preserve the newest eligible batch rather than selecting an older, more optimistic forecast. */
export function highProbabilityPick<T extends StoredPrediction & { trainedUntil: Date }>(
  predictions: T[], kickoff: Date, now: Date, minimumPercent: number, filter = modelPickFilter(undefined)
): T | null {
  const eligible = predictions.filter((row) => row.asOfAt < kickoff && row.asOfAt <= now && row.trainedUntil <= row.asOfAt
    && Number.isFinite(row.probability) && row.probability >= 0 && row.probability <= 1);
  const pick = strongestPrediction(eligible, kickoff);
  return pick && pick.probability >= minimumPercent / 100
    && (filter.value === "ALL" || (pick.marketKey === filter.market && pick.selection === filter.selection))
    ? eligible.find((row) => row === pick)! : null;
}

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

export interface HistoricalSweetSpotRow {
  marketKey: string;
  selection: string;
  probability: number;
  win: boolean;
}

export interface HistoricalSweetSpot {
  marketKey: string;
  selection: string;
  threshold: number;
  matches: number;
  wins: number;
  hitRate: number;
  predicted: number;
  interval: { lower: number; upper: number };
}

/**
 * Finds a usable probability/selection combination from settled strongest picks.
 * A minimum sample avoids promoting a tiny all-win cohort; Wilson lower bound ranks
 * candidates conservatively, with hit rate and sample size as tie breakers.
 */
export function historicalSweetSpot(rows: HistoricalSweetSpotRow[], minimumSample = 50): HistoricalSweetSpot | null {
  const candidates: HistoricalSweetSpot[] = [];
  for (const selection of new Set(rows.map((row) => `${row.marketKey}\u0000${row.selection}`))) {
    const [marketKey, selectionKey] = selection.split("\u0000");
    for (const threshold of PROBABILITY_THRESHOLDS) {
      const cohort = rows.filter((row) => row.marketKey === marketKey && row.selection === selectionKey && row.probability >= threshold / 100);
      const matches = cohort.length;
      if (matches < minimumSample) continue;
      const wins = cohort.filter((row) => row.win).length;
      const hitRate = wins / matches;
      const predicted = cohort.reduce((sum, row) => sum + row.probability, 0) / matches;
      const z = 1.96;
      const denominator = 1 + z * z / matches;
      const centre = (hitRate + z * z / (2 * matches)) / denominator;
      const margin = z * Math.sqrt(hitRate * (1 - hitRate) / matches + z * z / (4 * matches * matches)) / denominator;
      candidates.push({ marketKey, selection: selectionKey, threshold, matches, wins, hitRate, predicted, interval: { lower: centre - margin, upper: centre + margin } });
    }
  }
  return candidates.sort((a, b) => b.interval.lower - a.interval.lower || b.hitRate - a.hitRate || b.threshold - a.threshold || b.matches - a.matches)[0] ?? null;
}
