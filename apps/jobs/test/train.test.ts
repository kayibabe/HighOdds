import { describe, expect, it } from "vitest";
import { NoTrainingDataError, assertTrainedAny } from "../src/train.js";

describe("assertTrainedAny", () => {
  it("throws NoTrainingDataError naming the backfill command when nothing trained", () => {
    expect(() => assertTrainedAny({ trained: 0, skipped: 42 })).toThrow(NoTrainingDataError);
    expect(() => assertTrainedAny({ trained: 0, skipped: 42 })).toThrow(/all 42 had fewer than 50 FINISHED fixtures.*jobs:backfill-fixtures/);
  });

  it("throws when there are no competitions at all", () => {
    expect(() => assertTrainedAny({ trained: 0, skipped: 0 })).toThrow(NoTrainingDataError);
  });

  it("passes when at least one competition trained, even if others were skipped", () => {
    expect(() => assertTrainedAny({ trained: 1, skipped: 500 })).not.toThrow();
  });
});
