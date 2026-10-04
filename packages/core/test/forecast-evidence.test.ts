import { describe, expect, it } from "vitest";
import { forecastEvidence, highProbabilityPick, modelPickFilter, MODEL_PICK_FILTERS, probabilityThreshold, PROBABILITY_THRESHOLDS, type EvidenceForecast } from "../src/forecast-evidence.js";

const target = { fixtureId: "target", competitionId: "league", market: "TOTAL_GOALS", selection: "OVER_2_5",
  method: "poisson", probability: 0.75, forecastAt: new Date("2026-10-01") };
const row: EvidenceForecast = { ...target, fixtureId: "past", probability: 0.72, forecastAt: new Date("2026-09-01"),
  trainedUntil: new Date("2026-08-31"), kickoff: new Date("2026-09-02"), resultRecordedAt: new Date("2026-09-03"), hit: true };

describe("daily high-probability picks", () => {
  const kickoff = new Date("2026-10-04T18:00:00Z");
  const now = new Date("2026-10-04T12:00:00Z");
  const pick = { marketKey: "TOTAL_GOALS", selection: "OVER_2_5", probability: 0.7,
    asOfAt: new Date("2026-10-04T10:00:00Z"), trainedUntil: new Date("2026-10-03"), method: "poisson" };
  it.each(PROBABILITY_THRESHOLDS)("includes exactly %s percent and excludes values below the threshold", (threshold) => {
    const boundary = { ...pick, probability: threshold / 100 };
    expect(highProbabilityPick([boundary], kickoff, now, threshold)).toBe(boundary);
    expect(highProbabilityPick([{ ...boundary, probability: boundary.probability - 0.001 }], kickoff, now, threshold)).toBeNull();
  });
  it("uses the latest eligible batch and preserves method metadata", () => {
    const earlier = { ...pick, probability: 0.95, asOfAt: new Date("2026-10-04T08:00:00Z") };
    expect(highProbabilityPick([earlier, pick], kickoff, now, 80)).toBeNull();
    expect(highProbabilityPick([earlier, pick], kickoff, now, 60)).toBe(pick);
  });
  it("rejects future, kickoff-time, look-ahead and invalid forecasts", () => {
    for (const invalid of [
      { ...pick, asOfAt: new Date("2026-10-04T13:00:00Z") }, { ...pick, asOfAt: kickoff },
      { ...pick, trainedUntil: now }, { ...pick, probability: NaN },
      { ...pick, probability: 1.1 }, { ...pick, marketKey: null }
    ]) expect(highProbabilityPick([invalid], kickoff, now, 60)).toBeNull();
    expect(highProbabilityPick([{ ...pick, asOfAt: kickoff }, { ...pick, trainedUntil: now }], kickoff, kickoff, 60)).toBeNull();
  });
  it("accepts only supported filter values and defaults to 90", () => {
    for (const threshold of PROBABILITY_THRESHOLDS) expect(probabilityThreshold(String(threshold))).toBe(threshold);
    for (const invalid of [undefined, "35", "100", "bad", ["90", "55"]]) expect(probabilityThreshold(invalid)).toBe(90);
  });
  it("filters the strongest model pick and does not substitute a weaker selection", () => {
    const stronger = { ...pick, marketKey: "BTTS", selection: "YES", probability: 0.85 };
    expect(highProbabilityPick([pick, stronger], kickoff, now, 60, modelPickFilter("OVER_2_5"))).toBeNull();
    expect(highProbabilityPick([pick, stronger], kickoff, now, 60, modelPickFilter("BTTS_YES"))).toBe(stronger);
    expect(highProbabilityPick([pick], kickoff, now, 70, modelPickFilter("OVER_2_5"))).toBe(pick);
    expect(highProbabilityPick([pick], kickoff, now, 80, modelPickFilter("OVER_2_5"))).toBeNull();
  });
  it("matches both market and selection for each filter and safely defaults to all", () => {
    for (const filter of MODEL_PICK_FILTERS.filter((item) => item.value !== "ALL")) {
      const matching = { ...pick, marketKey: filter.market, selection: filter.selection };
      expect(highProbabilityPick([matching], kickoff, now, 60, modelPickFilter(filter.value))).toBe(matching);
      expect(highProbabilityPick([{ ...matching, marketKey: "OTHER" }], kickoff, now, 60, modelPickFilter(filter.value))).toBeNull();
    }
    for (const invalid of [undefined, "bad", ["OVER_2_5", "HOME"]]) expect(modelPickFilter(invalid).value).toBe("ALL");
  });
});

describe("forecast evidence", () => {
  it("compares same selection and band, reporting wins, forecast mean and uncertainty", () => {
    const result = forecastEvidence([row, { ...row, fixtureId: "loss", probability: 0.78, hit: false }], target);
    expect(result.matches).toBe(2);
    expect(result.observed).toBe(0.5);
    expect(result.predicted).toBeCloseTo(0.75);
    expect(result.gap).toBeCloseTo(-0.25);
    expect(result.interval!.lower).toBeLessThan(0.5);
    expect(result.interval!.upper).toBeGreaterThan(0.5);
  });
  it("excludes leakage, other cohorts, stale history and the target itself", () => {
    const excluded: EvidenceForecast[] = [
      { ...row, fixtureId: target.fixtureId }, { ...row, competitionId: "other" },
      { ...row, selection: "UNDER_2_5" }, { ...row, market: "BTTS" }, { ...row, method: "other" },
      { ...row, probability: 0.8 }, { ...row, kickoff: new Date("2026-01-01") },
      { ...row, resultRecordedAt: target.forecastAt }, { ...row, forecastAt: row.kickoff },
      { ...row, trainedUntil: row.kickoff }, { ...row, kickoff: target.forecastAt }
    ];
    expect(forecastEvidence(excluded, target).matches).toBe(0);
    expect(forecastEvidence([], target).interval).toBeNull();
  });
  it("deduplicates before band filtering, so an older in-band forecast cannot replace the latest", () => {
    expect(forecastEvidence([row, { ...row, probability: 0.85, forecastAt: new Date("2026-09-01T12:00:00Z") }], target).matches).toBe(0);
    expect(forecastEvidence([row, row], target).matches).toBe(1);
  });
  it("includes 100% in the final band and retains uncertainty even after all wins", () => {
    const result = forecastEvidence([{ ...row, probability: 1 }], { ...target, probability: 1 });
    expect(result.matches).toBe(1);
    expect(result.lower).toBe(0.9);
    expect(result.interval!.lower).toBeLessThan(0.5);
    expect(result.interval!.upper).toBeCloseTo(1);
  });
});
