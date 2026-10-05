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

/** The market's highest-probability selection for one fixture, with the closing price it could have been backed at. */
export interface ModelPick {
  fixtureId: string;
  marketKey: string;
  selection: string;
  probability: number;
  hit: boolean;
  /** Last pre-kickoff price for the pick; null when no active bookmaker quoted it. */
  closingOdds: number | null;
}

/** One pick per fixture and market: the selection with the highest probability (first wins a tie), as on the Research page. */
export function modelPicks(rows: ScoredPrediction[], closingOdds: (row: ScoredPrediction) => number | null): ModelPick[] {
  return [...groupBy(rows, (row) => `${row.fixtureId}\u0000${row.marketKey}`).values()].map((group) => {
    const pick = group.reduce((best, row) => (row.probability > best.probability ? row : best));
    return { fixtureId: pick.fixtureId, marketKey: pick.marketKey, selection: pick.selection, probability: pick.probability, hit: pick.hit, closingOdds: closingOdds(pick) };
  });
}

export interface PickPerformance {
  group: string;
  picks: number;
  hits: number;
  hitRate: number | null;
  /** Mean model probability over the same picks. */
  expectedHitRate: number | null;
  /** Picks with a closing price; profit and ROI cover only these. */
  priced: number;
  avgOdds: number | null;
  /** One unit on every priced pick at its closing price. */
  profitUnits: number;
  roiPercent: number | null;
  /** One standard error of the ROI, so a small sample is not read as an edge. */
  roiStdErrPercent: number | null;
  /** Priced picks where probability × closing odds > 1 (model edge before any haircut). */
  valuePicks: number;
  valueHitRate: number | null;
  valueProfitUnits: number;
  valueRoiPercent: number | null;
}

const pickProfit = (pick: ModelPick) => pick.hit ? pick.closingOdds! - 1 : -1;

function pickPerformance(group: string, picks: ModelPick[]): PickPerformance {
  const hits = picks.filter((pick) => pick.hit).length;
  const priced = picks.filter((pick) => pick.closingOdds !== null);
  const profits = priced.map(pickProfit);
  const profitUnits = profits.reduce((sum, value) => sum + value, 0);
  const meanProfit = mean(profits);
  const variance = profits.length < 2 ? null : profits.reduce((sum, value) => sum + (value - meanProfit!) ** 2, 0) / (profits.length - 1);
  const value = priced.filter((pick) => pick.probability * pick.closingOdds! > 1);
  const valueProfitUnits = value.reduce((sum, pick) => sum + pickProfit(pick), 0);
  return {
    group, picks: picks.length, hits,
    hitRate: picks.length === 0 ? null : hits / picks.length,
    expectedHitRate: mean(picks.map((pick) => pick.probability)),
    priced: priced.length,
    avgOdds: mean(priced.map((pick) => pick.closingOdds!)),
    profitUnits,
    roiPercent: meanProfit === null ? null : meanProfit * 100,
    roiStdErrPercent: variance === null ? null : Math.sqrt(variance / profits.length) * 100,
    valuePicks: value.length,
    valueHitRate: value.length === 0 ? null : value.filter((pick) => pick.hit).length / value.length,
    valueProfitUnits,
    valueRoiPercent: value.length === 0 ? null : valueProfitUnits / value.length * 100
  };
}

/** Narrows the picks to test a strategy, e.g. only Over 2.5 at odds of 1.50 or more. */
export interface PickFilter {
  market: string | null;
  selection: string | null;
  /** Inclusive minimum closing price; unpriced picks are dropped because their odds are unknown. */
  minOdds: number | null;
}

export const NO_PICK_FILTER: PickFilter = { market: null, selection: null, minOdds: null };

/** Reads `pick` ("MARKET" or "MARKET:SELECTION") and `minOdds` from query parameters, ignoring malformed values. */
export function parsePickFilter(params: { pick?: unknown; minOdds?: unknown }): PickFilter {
  const pick = typeof params.pick === "string" ? /^([A-Z0-9_]+)(?::([A-Z0-9_]+))?$/.exec(params.pick) : null;
  const minOdds = typeof params.minOdds === "string" && params.minOdds.trim() !== "" ? Number(params.minOdds) : NaN;
  return {
    market: pick?.[1] ?? null,
    selection: pick?.[2] ?? null,
    minOdds: Number.isFinite(minOdds) && minOdds > 1 && minOdds <= 1000 ? minOdds : null
  };
}

export const isPickFilterActive = (filter: PickFilter) => filter.market !== null || filter.minOdds !== null;

export function filterPicks(picks: ModelPick[], filter: PickFilter): ModelPick[] {
  return picks.filter((pick) =>
    (filter.market === null || pick.marketKey === filter.market)
    && (filter.selection === null || pick.selection === filter.selection)
    && (filter.minOdds === null || (pick.closingOdds !== null && pick.closingOdds >= filter.minOdds)));
}

/** Upper bounds (exclusive) of the pick-confidence bands; the last band is open-ended. */
export const PICK_CONFIDENCE_BANDS = [0.5, 0.6, 0.7, 0.8] as const;

function confidenceBand(probability: number): string {
  const upper = PICK_CONFIDENCE_BANDS.findIndex((bound) => probability < bound);
  if (upper === 0) return `< ${PICK_CONFIDENCE_BANDS[0] * 100}%`;
  if (upper === -1) return `≥ ${PICK_CONFIDENCE_BANDS[PICK_CONFIDENCE_BANDS.length - 1]! * 100}%`;
  return `${PICK_CONFIDENCE_BANDS[upper - 1]! * 100}–${PICK_CONFIDENCE_BANDS[upper]! * 100}%`;
}

/**
 * Hit rate and flat-stake ROI of the model's picks: per market with a pooled "ALL" row, per market
 * and selection (group "MARKET:SELECTION"), and per confidence band from least to most confident.
 */
export function summarizePicks(picks: ModelPick[]) {
  if (picks.length === 0) return { byMarket: [], bySelection: [], byBand: [] };
  const markets = [...new Set(picks.map((pick) => pick.marketKey))].sort();
  const bandOrder = [0, ...PICK_CONFIDENCE_BANDS].map(confidenceBand);
  return {
    byMarket: [...markets.map((market) => pickPerformance(market, picks.filter((pick) => pick.marketKey === market))), pickPerformance("ALL", picks)],
    bySelection: [...groupBy(picks, (pick) => `${pick.marketKey}:${pick.selection}`).entries()]
      .map(([group, rows]) => pickPerformance(group, rows)).sort((a, b) => a.group.localeCompare(b.group)),
    byBand: [...groupBy(picks, (pick) => confidenceBand(pick.probability)).entries()]
      .map(([group, rows]) => pickPerformance(group, rows)).sort((a, b) => bandOrder.indexOf(a.group) - bandOrder.indexOf(b.group))
  };
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

export const EXPLORATORY_COMPETITION_SAMPLE = 30;

export interface CompetitionSelectionCalibration extends SelectionCalibration {
  competition: string;
  exploratory: boolean;
}

/** Calibration by competition, market and selection. Small cohorts are descriptive only. */
export function calibrationByCompetitionSelection(rows: Array<ScoredPrediction & { competition: string }>, exploratoryBelow = EXPLORATORY_COMPETITION_SAMPLE): CompetitionSelectionCalibration[] {
  return [...groupBy(rows, (row) => `${row.competition}\u0000${row.marketKey}\u0000${row.selection}`).values()].map((group) => {
    const meanPredicted = mean(group.map((row) => row.probability))!;
    const observedRate = group.filter((row) => row.hit).length / group.length;
    return {
      competition: group[0]!.competition, market: group[0]!.marketKey, selection: group[0]!.selection,
      predictions: group.length, meanPredicted, observedRate, bias: meanPredicted - observedRate,
      exploratory: group.length < exploratoryBelow
    };
  }).sort((a, b) => b.predictions - a.predictions || a.competition.localeCompare(b.competition) || a.market.localeCompare(b.market) || a.selection.localeCompare(b.selection));
}

/** A prospectively captured candidate and its eventual fixture result, if known. */
export interface CandidateUniverseInput {
  marketKey: string;
  selection: string;
  decimalOdds: number;
  probability: number;
  confidenceScore: number;
  competition: string;
  bookmaker: string;
  /** null means the candidate passed the leg-level gates at publication time. */
  baseEligibilityReason: string | null;
  /** True if the captured policy allowed this candidate in at least one ticket tier. */
  eligibleForAnyTier: boolean;
  selected: boolean;
  ticketTier: string | null;
  confidenceThreshold: number | null;
  outcome: "WIN" | "LOSS" | "VOID" | "PENDING" | "UNRESOLVED";
}

export interface CandidateCohortPerformance {
  group: string;
  cohort: "Selected" | "Eligible not selected";
  legs: number;
  wins: number;
  losses: number;
  pending: number;
  hitRate: number | null;
  expectedHitRate: number | null;
  profitUnits: number;
  roiPercent: number | null;
}

export interface CandidateUniverseSummary {
  captured: number;
  eligible: number;
  selected: number;
  selectedWithoutEligibility: number;
  cohorts: CandidateCohortPerformance[];
  byMarket: CandidateCohortPerformance[];
  byOddsBand: CandidateCohortPerformance[];
  byProbabilityBand: CandidateCohortPerformance[];
  byCompetition: CandidateCohortPerformance[];
  byBookmaker: CandidateCohortPerformance[];
  byConfidence: CandidateCohortPerformance[];
  byTier: CandidateCohortPerformance[];
}

function candidateCohortPerformance(group: string, cohort: CandidateCohortPerformance["cohort"], rows: CandidateUniverseInput[]): CandidateCohortPerformance {
  const decided = rows.filter((row) => row.outcome === "WIN" || row.outcome === "LOSS" || row.outcome === "UNRESOLVED");
  const wins = decided.filter((row) => row.outcome === "WIN").length;
  const losses = decided.length - wins;
  const profitUnits = decided.reduce((sum, row) => sum + (row.outcome === "WIN" ? row.decimalOdds - 1 : -1), 0);
  return {
    group, cohort, legs: rows.length, wins, losses,
    pending: rows.filter((row) => row.outcome === "PENDING").length,
    hitRate: decided.length === 0 ? null : wins / decided.length,
    expectedHitRate: mean(decided.map((row) => row.probability)),
    profitUnits,
    roiPercent: decided.length === 0 ? null : profitUnits / decided.length * 100
  };
}

const oddsBand = (odds: number) => odds < 2 ? "1.80–1.99" : odds < 2.5 ? "2.00–2.49" : odds < 3 ? "2.50–2.99" : "≥ 3.00";
const probabilityBand = (probability: number) => probability < 0.5 ? "< 50%" : probability < 0.6 ? "50–59%" : probability < 0.7 ? "60–69%" : "≥ 70%";
const candidateCohort = (row: CandidateUniverseInput): CandidateCohortPerformance["cohort"] | null =>
  row.selected ? "Selected" : row.eligibleForAnyTier ? "Eligible not selected" : null;

function summarizeCandidateDimension(rows: CandidateUniverseInput[], groupFor: (row: CandidateUniverseInput) => string): CandidateCohortPerformance[] {
  const groups = new Map<string, CandidateUniverseInput[]>();
  for (const row of rows) {
    const cohort = candidateCohort(row);
    if (!cohort) continue;
    const group = `${groupFor(row)}\u0000${cohort}`;
    const values = groups.get(group) ?? [];
    values.push(row); groups.set(group, values);
  }
  return [...groups.entries()].map(([key, values]) => {
    const [group, cohort] = key.split("\u0000") as [string, CandidateCohortPerformance["cohort"]];
    return candidateCohortPerformance(group, cohort, values);
  }).sort((a, b) => a.group.localeCompare(b.group) || a.cohort.localeCompare(b.cohort));
}

/**
 * Compares published legs with every other candidate that passed the same leg-level gates at the
 * moment a ticket was published. This is descriptive paper research, not a promotion rule.
 */
export function summarizeCandidateUniverse(rows: CandidateUniverseInput[]): CandidateUniverseSummary {
  const cohorts = summarizeCandidateDimension(rows, () => "ALL");
  return {
    captured: rows.length,
    eligible: rows.filter((row) => row.eligibleForAnyTier).length,
    selected: rows.filter((row) => row.selected).length,
    selectedWithoutEligibility: rows.filter((row) => row.selected && row.baseEligibilityReason !== null).length,
    cohorts,
    byMarket: summarizeCandidateDimension(rows, (row) => `${row.marketKey}:${row.selection}`),
    byOddsBand: summarizeCandidateDimension(rows, (row) => oddsBand(row.decimalOdds)),
    byProbabilityBand: summarizeCandidateDimension(rows, (row) => probabilityBand(row.probability)),
    byCompetition: summarizeCandidateDimension(rows, (row) => row.competition),
    byBookmaker: summarizeCandidateDimension(rows, (row) => row.bookmaker),
    byConfidence: summarizeCandidateDimension(rows, (row) => row.confidenceScore >= 70 ? "≥ 70" : row.confidenceScore >= 65 ? "65–69" : row.confidenceScore >= 60 ? "60–64" : "< 60"),
    byTier: summarizeCandidateDimension(rows, (row) => row.selected ? `${row.ticketTier ?? "Unknown"} @ ${row.confidenceThreshold ?? "?"}` : "Not selected")
  };
}

/** One published leg's post-publication quote history, used to judge whether CLV is observable. */
export interface QuoteCadenceInput {
  marketKey: string;
  bookmaker: string;
  /** Quotes captured strictly after the ticket publication and before kickoff. */
  postPublicationUpdates: number;
  /** CLV is only valid when a quote was captured strictly after the entry quote, before kickoff. */
  clvPercent: number | null;
}

export interface QuoteCadencePerformance {
  group: string;
  legs: number;
  legsWithPostPublicationUpdate: number;
  updateCoverage: number | null;
  meanPostPublicationUpdates: number | null;
  legsWithValidClv: number;
  meanClvPercent: number | null;
}

function quoteCadencePerformance(group: string, rows: QuoteCadenceInput[]): QuoteCadencePerformance {
  const validClv = rows.flatMap((row) => row.clvPercent === null ? [] : [row.clvPercent]);
  const updated = rows.filter((row) => row.postPublicationUpdates > 0).length;
  return {
    group, legs: rows.length, legsWithPostPublicationUpdate: updated,
    updateCoverage: rows.length === 0 ? null : updated / rows.length,
    meanPostPublicationUpdates: mean(rows.map((row) => row.postPublicationUpdates)),
    legsWithValidClv: validClv.length, meanClvPercent: mean(validClv)
  };
}

/** Quote-update observability by market and bookmaker. CLV must be absent when no later quote exists. */
export function summarizeQuoteCadence(rows: QuoteCadenceInput[]) {
  const summarize = (keyFor: (row: QuoteCadenceInput) => string) =>
    [...groupBy(rows, keyFor).entries()].map(([group, values]) => quoteCadencePerformance(group, values)).sort((a, b) => a.group.localeCompare(b.group));
  return { overall: quoteCadencePerformance("ALL", rows), byMarket: summarize((row) => row.marketKey), byBookmaker: summarize((row) => row.bookmaker) };
}
