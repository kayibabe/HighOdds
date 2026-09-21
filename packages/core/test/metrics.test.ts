import { describe, expect, it } from "vitest";
import { clvPercent, computeRoi } from "../src/metrics.js";

describe("computeRoi", () => {
  it("computes per-tier ROI excluding pending settlements", () => {
    const [standard] = computeRoi([
      { tier: "STANDARD", outcome: "WIN", profitUnits: 4.5 },
      { tier: "STANDARD", outcome: "LOSS", profitUnits: -1 },
      { tier: "STANDARD", outcome: "PENDING", profitUnits: null }
    ]);
    expect(standard!.settled).toBe(2);
    expect(standard!.profitUnits).toBeCloseTo(3.5, 6);
    expect(standard!.roiPercent).toBeCloseTo(175, 6);
  });
});

describe("clvPercent", () => {
  it("is positive when the entry price beat the closing price", () => {
    expect(clvPercent(2.2, 2.0)).toBeCloseTo(10, 6);
  });
  it("rejects odds at or below 1", () => {
    expect(() => clvPercent(1, 2)).toThrow();
  });
});
