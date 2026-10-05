import { describe, expect, it } from "vitest";
import {
  calibrationBuckets, calibrationByCompetitionSelection, calibrationByMarket, calibrationBySelection, calibrationBySelectionProbability, filterPicks, isPickFilterActive, median, modelPicks, NO_PICK_FILTER,
  parsePickFilter, summarizeCandidateUniverse, summarizeLegs, summarizePicks, summarizeQuoteCadence, summarizeTiers,
  type ModelPick, type ScoredPrediction
} from "../src/analysis.js";

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

describe("modelPicks", () => {
  it("takes the highest-probability selection per fixture and market with its closing price", () => {
    const picks = modelPicks(rows, (row) => row.selection === "HOME" ? 2 : null);
    expect(picks).toHaveLength(3);
    expect(picks.find((pick) => pick.fixtureId === "f1" && pick.marketKey === "MATCH_WINNER")).toMatchObject({ selection: "HOME", hit: true, closingOdds: 2 });
    expect(picks.find((pick) => pick.fixtureId === "f2")).toMatchObject({ selection: "HOME", hit: false, closingOdds: 2 });
    expect(picks.find((pick) => pick.marketKey === "TOTAL_GOALS")).toMatchObject({ selection: "OVER_2_5", probability: 0.55, closingOdds: null });
  });
});

describe("summarizePicks", () => {
  const pick = (marketKey: string, selection: string, probability: number, hit: boolean, closingOdds: number | null): ModelPick =>
    ({ fixtureId: `${marketKey}-${probability}-${closingOdds}`, marketKey, selection, probability, hit, closingOdds });
  const picks = [
    pick("MATCH_WINNER", "HOME", 0.55, true, 2.1),   // value, +1.1
    pick("MATCH_WINNER", "HOME", 0.52, false, 1.8),  // no value, −1
    pick("MATCH_WINNER", "AWAY", 0.45, false, 2.5),  // value, −1
    pick("TOTAL_GOALS", "OVER_2_5", 0.82, true, null) // unpriced
  ];
  const { byMarket, bySelection, byBand } = summarizePicks(picks);

  it("reports hit rate over every pick and flat-stake ROI over priced picks", () => {
    const [matchWinner, totalGoals, all] = byMarket;
    expect(matchWinner!.picks).toBe(3);
    expect(matchWinner!.hitRate).toBeCloseTo(1 / 3, 10);
    expect(matchWinner!.expectedHitRate).toBeCloseTo((0.55 + 0.52 + 0.45) / 3, 10);
    expect(matchWinner!.profitUnits).toBeCloseTo(-0.9, 10);
    expect(matchWinner!.roiPercent).toBeCloseTo(-30, 10);
    // Sample SD of [1.1, −1, −1] is √1.47; SE = √(1.47 / 3).
    expect(matchWinner!.roiStdErrPercent).toBeCloseTo(Math.sqrt(1.47 / 3) * 100, 8);
    expect(matchWinner!.valuePicks).toBe(2);
    expect(matchWinner!.valueHitRate).toBe(0.5);
    expect(matchWinner!.valueRoiPercent).toBeCloseTo(5, 10);
    expect(totalGoals!.hitRate).toBe(1);
    expect(totalGoals!.priced).toBe(0);
    expect(totalGoals!.roiPercent).toBeNull();
    expect(totalGoals!.roiStdErrPercent).toBeNull();
    expect(all!.group).toBe("ALL");
    expect(all!.picks).toBe(4);
    expect(all!.priced).toBe(3);
  });

  it("groups by selection and orders confidence bands from low to high", () => {
    expect(bySelection.map((row) => row.group)).toEqual(["MATCH_WINNER:AWAY", "MATCH_WINNER:HOME", "TOTAL_GOALS:OVER_2_5"]);
    expect(byBand.map((row) => [row.group, row.picks])).toEqual([["< 50%", 1], ["50–60%", 2], ["≥ 80%", 1]]);
  });

  it("returns empty groups for no picks", () => {
    expect(summarizePicks([])).toEqual({ byMarket: [], bySelection: [], byBand: [] });
  });

  it("filters by market, selection and minimum odds, dropping unpriced picks when odds are required", () => {
    expect(filterPicks(picks, NO_PICK_FILTER)).toHaveLength(4);
    expect(filterPicks(picks, { market: "MATCH_WINNER", selection: null, minOdds: null })).toHaveLength(3);
    expect(filterPicks(picks, { market: "MATCH_WINNER", selection: "HOME", minOdds: null })).toHaveLength(2);
    expect(filterPicks(picks, { market: "MATCH_WINNER", selection: "HOME", minOdds: 2.1 }).map((row) => row.closingOdds)).toEqual([2.1]);
    expect(filterPicks(picks, { market: "TOTAL_GOALS", selection: null, minOdds: 1.01 })).toEqual([]);
  });
});

describe("parsePickFilter", () => {
  it("reads a market or market:selection and a minimum price", () => {
    expect(parsePickFilter({ pick: "TOTAL_GOALS:OVER_2_5", minOdds: "1.5" })).toEqual({ market: "TOTAL_GOALS", selection: "OVER_2_5", minOdds: 1.5 });
    expect(parsePickFilter({ pick: "BTTS" })).toEqual({ market: "BTTS", selection: null, minOdds: null });
    expect(isPickFilterActive(parsePickFilter({}))).toBe(false);
  });

  it("ignores malformed or meaningless values", () => {
    expect(parsePickFilter({ pick: "over; drop", minOdds: "abc" })).toEqual(NO_PICK_FILTER);
    expect(parsePickFilter({ pick: ["BTTS"], minOdds: "1" })).toEqual(NO_PICK_FILTER);
    expect(parsePickFilter({ minOdds: "" })).toEqual(NO_PICK_FILTER);
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

describe("calibrationByCompetitionSelection", () => {
  it("keeps competition cohorts separate and marks small samples exploratory", () => {
    const result = calibrationByCompetitionSelection([
      { ...rows[0]!, competition: "League A" }, { ...rows[1]!, competition: "League A" },
      { ...rows[2]!, competition: "League B" }
    ], 3);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ competition: "League A", market: "MATCH_WINNER", selection: "HOME", predictions: 1, exploratory: true }),
      expect.objectContaining({ competition: "League B", market: "MATCH_WINNER", selection: "AWAY", predictions: 1, exploratory: true })
    ]));
  });
});

describe("calibrationBySelectionProbability", () => {
  it("keeps probability buckets separate by selection and marks sparse buckets exploratory", () => {
    const result = calibrationBySelectionProbability([
      { fixtureId: "f1", marketKey: "MATCH_WINNER", selection: "AWAY", probability: 0.35, hit: false },
      { fixtureId: "f2", marketKey: "MATCH_WINNER", selection: "AWAY", probability: 0.45, hit: true },
      { fixtureId: "f3", marketKey: "MATCH_WINNER", selection: "HOME", probability: 0.85, hit: true }
    ], 5, 2);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ market: "MATCH_WINNER", selection: "AWAY", lower: 0.2, upper: 0.4, predictions: 1, exploratory: true }),
      expect.objectContaining({ market: "MATCH_WINNER", selection: "HOME", lower: 0.8, upper: 1, predictions: 1, exploratory: true })
    ]));
  });
});

describe("summarizeCandidateUniverse", () => {
  it("compares selected legs with eligible non-selected candidates without treating rejected rows as a cohort", () => {
    const summary = summarizeCandidateUniverse([
      { marketKey: "TOTAL_GOALS", selection: "OVER_2_5", decimalOdds: 1.9, probability: 0.6, confidenceScore: 72, competition: "A", bookmaker: "Book", baseEligibilityReason: null, eligibleForAnyTier: true, selected: true, ticketTier: "STANDARD", confidenceThreshold: 70, outcome: "WIN" },
      { marketKey: "TOTAL_GOALS", selection: "UNDER_2_5", decimalOdds: 2.1, probability: 0.55, confidenceScore: 68, competition: "A", bookmaker: "Book", baseEligibilityReason: null, eligibleForAnyTier: true, selected: false, ticketTier: null, confidenceThreshold: null, outcome: "LOSS" },
      { marketKey: "BTTS", selection: "YES", decimalOdds: 1.7, probability: 0.6, confidenceScore: 75, competition: "B", bookmaker: "Book", baseEligibilityReason: "ODDS_BELOW_1_80", eligibleForAnyTier: false, selected: false, ticketTier: null, confidenceThreshold: null, outcome: "WIN" }
    ]);
    expect(summary).toMatchObject({ captured: 3, eligible: 2, selected: 1, selectedWithoutEligibility: 0 });
    const selected = summary.cohorts.find((row) => row.cohort === "Selected")!;
    const unselected = summary.cohorts.find((row) => row.cohort === "Eligible not selected")!;
    expect(selected).toMatchObject({ legs: 1, wins: 1 });
    expect(selected.roiPercent).toBeCloseTo(90, 10);
    expect(unselected).toMatchObject({ legs: 1, losses: 1, roiPercent: -100 });
    expect(summary.byTier).toEqual(expect.arrayContaining([
      expect.objectContaining({ group: "STANDARD @ 70", cohort: "Selected" }),
      expect.objectContaining({ group: "Not selected", cohort: "Eligible not selected" })
    ]));
  });
});

describe("summarizeQuoteCadence", () => {
  it("does not manufacture CLV where a later pre-kickoff quote was not captured", () => {
    const summary = summarizeQuoteCadence([
      { marketKey: "MATCH_WINNER", bookmaker: "Book", postPublicationUpdates: 0, clvPercent: null },
      { marketKey: "MATCH_WINNER", bookmaker: "Book", postPublicationUpdates: 2, clvPercent: 1.5 },
      { marketKey: "BTTS", bookmaker: "Other", postPublicationUpdates: 1, clvPercent: -0.5 }
    ]);
    expect(summary.overall).toMatchObject({ legs: 3, legsWithPostPublicationUpdate: 2, legsWithValidClv: 2 });
    expect(summary.overall.updateCoverage).toBeCloseTo(2 / 3, 10);
    expect(summary.overall.meanClvPercent).toBeCloseTo(0.5, 10);
    expect(summary.byMarket.find((row) => row.group === "MATCH_WINNER")).toMatchObject({ legs: 2, legsWithValidClv: 1 });
  });
});
