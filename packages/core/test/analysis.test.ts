import { describe, expect, it } from "vitest";
import { calibrationBuckets, calibrationByMarket, calibrationBySelection, median, summarizeLegs, summarizeTiers, type ScoredPrediction } from "../src/analysis.js";

// Two Match Winner fixtures and one Total Goals fixture, resolved against their final scores.
const rows: ScoredPrediction[] = [
  { fixtureId: "f1", marketKey: "MATCH_WINNER", selection: "HOME", probability: 0.5, hit: true },
  { fixtureId: "f1", marketKey: "MATCH_WINNER", selection: "DRAW", probability: 0.3, hit: false },
  { fixtureId: "f1", marketKey: "MATCH_WINNER", selection: "AWAY", probability: 0.2, hit: false },
  { fixtureId: "f2", marketKey: "MATCH_WINNER", selection: "HOME", probability: 0.6, hit: false },
  { fixtureId: "f2", marketKey: "MATCH_WINNER", selection: "DRAW", probability: 0.25, hit: false },
  { fixtureId: "f2", marketKey: "MATCH_WINNER", selection: "AWAY", probability: 0.15, hit: true },
  { fixtureId: "f1", marketKey: "TOTAL_GOALS", selection: "OVER_2_5", probability: 0.55, hit: true },
  { fixtureId: "f1", marketKey: "TOTAL_GOALS", selection: "UNDER_2_5", probability: 0.45, hit: false }
];

describe("median", () => {
  it("handles odd, even and empty inputs", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("calibrationByMarket", () => {
  it("scores each market and a pooled ALL row", () => {
    const [matchWinner, totalGoals, all] = calibrationByMarket(rows);
    expect(matchWinner!.market).toBe("MATCH_WINNER");
    expect(matchWinner!.fixtures).toBe(2);
    expect(matchWinner!.predictions).toBe(6);
    // (0.25 + 0.09 + 0.04 + 0.36 + 0.0625 + 0.7225) / 6
    expect(matchWinner!.brier).toBeCloseTo(1.525 / 6, 10);
    // f1 pick HOME hit; f2 pick HOME missed.
    expect(matchWinner!.pickHits).toBe(1);
    expect(matchWinner!.pickAccuracy).toBe(0.5);
    expect(totalGoals!.brier).toBeCloseTo((0.2025 + 0.2025) / 2, 10);
    expect(totalGoals!.logLoss).toBeCloseTo(-(Math.log(0.55) + Math.log(0.55)) / 2, 10);
    expect(all!.market).toBe("ALL");
    expect(all!.predictions).toBe(8);
    expect(all!.fixtures).toBe(3);
    expect(all!.pickHits).toBe(2);
  });

  it("keeps log-loss finite for certain forecasts that miss", () => {
    const [row] = calibrationByMarket([{ fixtureId: "f", marketKey: "BTTS", selection: "YES", probability: 1, hit: false }]);
    expect(Number.isFinite(row!.logLoss)).toBe(true);
  });

  it("returns nothing for no rows", () => {
    expect(calibrationByMarket([])).toEqual([]);
  });
});

describe("calibrationBySelection", () => {
  it("compares the mean forecast with the observed rate", () => {
    const home = calibrationBySelection(rows).find((row) => row.market === "MATCH_WINNER" && row.selection === "HOME")!;
    expect(home.predictions).toBe(2);
    expect(home.meanPredicted).toBeCloseTo(0.55, 10);
    expect(home.observedRate).toBe(0.5);
    expect(home.bias).toBeCloseTo(0.05, 10);
  });
});

describe("calibrationBuckets", () => {
  it("bins by probability and puts 1.0 in the top bucket", () => {
    const buckets = calibrationBuckets([...rows, { fixtureId: "f3", marketKey: "BTTS", selection: "YES", probability: 1, hit: true }], 10);
    expect(buckets).toHaveLength(10);
    expect(buckets[5]!.predictions).toBe(2); // 0.5 and 0.55
    expect(buckets[5]!.observedRate).toBe(1);
    expect(buckets[9]!.predictions).toBe(1);
    expect(buckets[0]!.predictions).toBe(0);
    expect(buckets[0]!.meanPredicted).toBeNull();
  });
});

describe("summarizeTiers", () => {
  it("reports hit rate against the model's expected rate and ROI per tier", () => {
    const [standard, value, high] = summarizeTiers([
      { tier: "STANDARD", outcome: "WIN", profitUnits: 5.5, combinedOdds: 6.5, legProbabilities: [0.5, 0.4], relaxed: false },
      { tier: "STANDARD", outcome: "LOSS", profitUnits: -1, combinedOdds: 7, legProbabilities: [0.5, 0.3], relaxed: true },
      { tier: "STANDARD", outcome: "VOID", profitUnits: 0, combinedOdds: 8, legProbabilities: [0.6, 0.3], relaxed: false },
      { tier: "STANDARD", outcome: "PENDING", profitUnits: null, combinedOdds: 5, legProbabilities: [0.5, 0.5, 0.5], relaxed: false },
      { tier: "VALUE", outcome: "PENDING", profitUnits: null, combinedOdds: 12, legProbabilities: [0.4, 0.3], relaxed: false }
    ]);
    expect(standard!.published).toBe(4);
    expect(standard!.settled).toBe(3);
    expect(standard!.hitRate).toBe(0.5);
    expect(standard!.expectedHitRate).toBeCloseTo((0.2 + 0.15) / 2, 10);
    expect(standard!.profitUnits).toBeCloseTo(4.5, 10);
    expect(standard!.roiPercent).toBeCloseTo(150, 10);
    expect(standard!.avgLegs).toBe(2.25);
    expect(standard!.relaxedShare).toBe(0.25);
    expect(value!.hitRate).toBeNull();
    expect(value!.roiPercent).toBeNull();
    expect(high!.published).toBe(0);
    expect(high!.avgCombinedOdds).toBeNull();
  });
});

describe("summarizeLegs", () => {
  it("counts unresolved legs as losses and averages edge and confidence", () => {
    const [btts, matchWinner, all] = summarizeLegs([
      { marketKey: "MATCH_WINNER", outcome: "WIN", decimalOdds: 2, probability: 0.55, confidenceScore: 80 },
      { marketKey: "MATCH_WINNER", outcome: "UNRESOLVED", decimalOdds: 2.5, probability: 0.45, confidenceScore: null },
      { marketKey: "BTTS", outcome: "PENDING", decimalOdds: 1.9, probability: 0.6, confidenceScore: 70 }
    ]);
    expect(btts!.market).toBe("BTTS");
    expect(btts!.hitRate).toBeNull();
    expect(matchWinner!.losses).toBe(1);
    expect(matchWinner!.hitRate).toBe(0.5);
    expect(matchWinner!.expectedHitRate).toBeCloseTo(0.5, 10);
    expect(matchWinner!.avgEdgePercent).toBeCloseTo(((0.55 * 2 - 1) + (0.45 * 2.5 - 1)) / 2 * 100, 10);
    expect(matchWinner!.avgConfidence).toBe(80);
    expect(all!.legs).toBe(3);
  });
});
