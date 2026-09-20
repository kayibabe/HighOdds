import { describe, expect, it } from "vitest";
import { conservativeExpectedValue, devigProbability, impliedProbability } from "../src/odds.js";

describe("odds mathematics", () => {
  it("derives a de-vigged probability", () => {
    expect(devigProbability(2, [2, 2])).toBeCloseTo(0.5, 8);
    expect(impliedProbability(2)).toBe(0.5);
  });
  it("applies a conservative haircut to EV", () => {
    expect(conservativeExpectedValue(0.6, 2, 0.02)).toBeCloseTo(0.176, 8);
  });
});
