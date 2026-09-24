import type { LegOutcome, TicketOutcome } from "./settlement.js";

/**
 * Aggregations behind the analysis page. Pure functions over already-loaded rows, so the numbers
 * the page reports are unit-tested rather than assembled ad hoc in JSX.
 */

type Tier = "STANDARD" | "VALUE" | "HIGH";
const TIERS: Tier[] = ["STANDARD", "VALUE", "HIGH"];

const mean = (values: number[]): number | null => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(key(row));
    if (group) group.push(row); else groups.set(key(row), [row]);
  }
  return groups;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** One stored probability for one selection, resolved against the final score. */
export interface ScoredPrediction {
  fixtureId: string;
  marketKey: string;
  selection: string;
  probability: number;
  hit: boolean;
}

export interface MarketCalibration {
  market: string;
  fixtures: number;
  predictions: number;
  /** Mean squared error of each selection's probability against its 0/1 result; lower is better. */
  brier: number;
  /** Mean binary log-loss per selection; lower is better. */
  logLoss: number;
  /** Fixtures where the market's highest-probability selection was the result. */
  pickHits: number;
  pickAccuracy: number;
}

const LOG_LOSS_EPSILON = 1e-6;

function marketCalibration(market: string, rows: ScoredPrediction[]): MarketCalibration {
  const byFixture = groupBy(rows, (row) => `${row.fixtureId}:${row.marketKey}`);
  let pickHits = 0;
  for (const group of byFixture.values()) {
    const pick = group.reduce((best, row) => (row.probability > best.probability ? row : best));
    if (pick.hit) pickHits += 1;
  }
  const brier = rows.reduce((sum, row) => sum + (row.probability - Number(row.hit)) ** 2, 0) / rows.length;
  const logLoss = rows.reduce((sum, row) => {
    const p = Math.min(1 - LOG_LOSS_EPSILON, Math.max(LOG_LOSS_EPSILON, row.probability));
    return sum - (row.hit ? Math.log(p) : Math.log(1 - p));
  }, 0) / rows.length;
  return { market, fixtures: byFixture.size, predictions: rows.length, brier, logLoss, pickHits, pickAccuracy: pickHits / byFixture.size };
}

/** Per-market scores, followed by an "ALL" row pooling every market. Markets are sorted by name. */
export function calibrationByMarket(rows: ScoredPrediction[]): MarketCalibration[] {
  if (rows.length === 0) return [];
  const markets = [...new Set(rows.map((row) => row.marketKey))].sort();
  return [...markets.map((market) => marketCalibration(market, rows.filter((row) => row.marketKey === market))), marketCalibration("ALL", rows)];
}

export interface SelectionCalibration {
  market: string;
  selection: string;
  predictions: number;
  meanPredicted: number;
  observedRate: number;
  /** meanPredicted − observedRate: positive means the model overrates this selection. */
  bias: number;
}

/** Average forecast vs how often each selection actually happened, e.g. P(home) vs the home-win rate. */
export function calibrationBySelection(rows: ScoredPrediction[]): SelectionCalibration[] {
  return [...groupBy(rows, (row) => `${row.marketKey}\u0000${row.selection}`).values()].map((group) => {
    const meanPredicted = mean(group.map((row) => row.probability))!;
    const observedRate = group.filter((row) => row.hit).length / group.length;
    return { market: group[0]!.marketKey, selection: group[0]!.selection, predictions: group.length, meanPredicted, observedRate, bias: meanPredicted - observedRate };
  }).sort((a, b) => a.market.localeCompare(b.market) || a.selection.localeCompare(b.selection));
}

export interface CalibrationBucket {
  lower: number;
  upper: number;
  predictions: number;
  meanPredicted: number | null;
  observedRate: number | null;
}

/** Reliability table: forecasts binned by probability; a calibrated model has observedRate ≈ meanPredicted. */
export function calibrationBuckets(rows: ScoredPrediction[], bucketCount = 10): CalibrationBucket[] {
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({ lower: index / bucketCount, upper: (index + 1) / bucketCount, rows: [] as ScoredPrediction[] }));
  for (const row of rows) {
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor(row.probability * bucketCount)));
    buckets[index]!.rows.push(row);
  }
  return buckets.map((bucket) => ({
    lower: bucket.lower, upper: bucket.upper, predictions: bucket.rows.length,
    meanPredicted: mean(bucket.rows.map((row) => row.probability)),
    observedRate: bucket.rows.length === 0 ? null : bucket.rows.filter((row) => row.hit).length / bucket.rows.length
  }));
}

export interface TicketSummaryInput {
  tier: Tier;
  outcome: TicketOutcome;
  profitUnits: number | null;
  combinedOdds: number;
  /** Model probability of each leg at publication. */
  legProbabilities: number[];
  relaxed: boolean;
}

export interface TierPerformance {
  tier: Tier;
  published: number;
  settled: number;
  wins: number;
  losses: number;
  voids: number;
  pending: number;
  /** Wins over decided (won or lost) tickets. */
  hitRate: number | null;
  /** Mean model win probability (product of leg probabilities) over the same decided tickets. */
  expectedHitRate: number | null;
  profitUnits: number;
  /** One unit per settled ticket, voids included at zero profit (matches computeRoi). */
  roiPercent: number | null;
  avgLegs: number | null;
  avgCombinedOdds: number | null;
  relaxedShare: number | null;
}

export function summarizeTiers(tickets: TicketSummaryInput[]): TierPerformance[] {
  return TIERS.map((tier) => {
    const rows = tickets.filter((ticket) => ticket.tier === tier);
    const settled = rows.filter((ticket) => ticket.outcome !== "PENDING");
    const decided = rows.filter((ticket) => ticket.outcome === "WIN" || ticket.outcome === "LOSS");
    const wins = rows.filter((ticket) => ticket.outcome === "WIN").length;
    const profitUnits = settled.reduce((sum, ticket) => sum + (ticket.profitUnits ?? 0), 0);
    return {
      tier, published: rows.length, settled: settled.length, wins,
      losses: rows.filter((ticket) => ticket.outcome === "LOSS").length,
      voids: rows.filter((ticket) => ticket.outcome === "VOID").length,
      pending: rows.filter((ticket) => ticket.outcome === "PENDING").length,
      hitRate: decided.length === 0 ? null : wins / decided.length,
      expectedHitRate: mean(decided.map((ticket) => ticket.legProbabilities.reduce((product, p) => product * p, 1))),
      profitUnits,
      roiPercent: settled.length === 0 ? null : profitUnits / settled.length * 100,
      avgLegs: mean(rows.map((ticket) => ticket.legProbabilities.length)),
      avgCombinedOdds: mean(rows.map((ticket) => ticket.combinedOdds)),
      relaxedShare: rows.length === 0 ? null : rows.filter((ticket) => ticket.relaxed).length / rows.length
    };
  });
}

export interface LegSummaryInput {
  marketKey: string;
  outcome: LegOutcome;
  decimalOdds: number;
  probability: number;
  /** Model/market agreement score at publication; null when the decision snapshot is missing. */
  confidenceScore: number | null;
}

export interface MarketLegPerformance {
  market: string;
  legs: number;
  wins: number;
  losses: number;
  voids: number;
  pending: number;
  hitRate: number | null;
  /** Mean model probability over the same decided legs. */
  expectedHitRate: number | null;
  avgOdds: number | null;
  /** Mean model edge, probability × odds − 1, in percent. */
  avgEdgePercent: number | null;
  avgConfidence: number | null;
}

function legPerformance(market: string, rows: LegSummaryInput[]): MarketLegPerformance {
  // UNRESOLVED legs lose the ticket at settlement, so they count as losses here too.
  const lost = (leg: LegSummaryInput) => leg.outcome === "LOSS" || leg.outcome === "UNRESOLVED";
  const decided = rows.filter((leg) => leg.outcome === "WIN" || lost(leg));
  const wins = rows.filter((leg) => leg.outcome === "WIN").length;
  const confidence = rows.flatMap((leg) => leg.confidenceScore === null ? [] : [leg.confidenceScore]);
  const edge = mean(rows.map((leg) => leg.probability * leg.decimalOdds - 1));
  return {
    market, legs: rows.length, wins, losses: rows.filter(lost).length,
    voids: rows.filter((leg) => leg.outcome === "VOID").length,
    pending: rows.filter((leg) => leg.outcome === "PENDING").length,
    hitRate: decided.length === 0 ? null : wins / decided.length,
    expectedHitRate: mean(decided.map((leg) => leg.probability)),
    avgOdds: mean(rows.map((leg) => leg.decimalOdds)),
    avgEdgePercent: edge === null ? null : edge * 100,
    avgConfidence: mean(confidence)
  };
}

/** Per-market leg results, followed by an "ALL" row. Markets are sorted by name. */
export function summarizeLegs(legs: LegSummaryInput[]): MarketLegPerformance[] {
  if (legs.length === 0) return [];
  const markets = [...new Set(legs.map((leg) => leg.marketKey))].sort();
  return [...markets.map((market) => legPerformance(market, legs.filter((leg) => leg.marketKey === market))), legPerformance("ALL", legs)];
}
