import { describe, expect, it } from "vitest";
import { forecastEvidence, type EvidenceForecast } from "../src/forecast-evidence.js";

const target = { fixtureId: "target", competitionId: "league", market: "TOTAL_GOALS", selection: "OVER_2_5",
  method: "poisson", probability: 0.75, forecastAt: new Date("2026-10-01") };
const row: EvidenceForecast = { ...target, fixtureId: "past", probability: 0.72, forecastAt: new Date("2026-09-01"),
  trainedUntil: new Date("2026-08-31"), kickoff: new Date("2026-09-02"), resultRecordedAt: new Date("2026-09-03"), hit: true };

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
