import { describe, expect, it } from "vitest";
import { missingOddsCoverageTargets, type OddsCoverageTarget } from "../src/odds-coverage.js";

const forecastAt = new Date("2026-10-04T05:45:00.000Z");
const kickoff = new Date("2026-10-04T12:00:00.000Z");
const target: OddsCoverageTarget = { fixtureId: "fixture-1", providerId: 10, kickoff, marketKey: "TOTAL_GOALS", selection: "OVER_2_5", forecastAt };

describe("missingOddsCoverageTargets", () => {
  it("keeps a target missing until an active-bookmaker quote is captured after the forecast and before kickoff", () => {
    expect(missingOddsCoverageTargets([target], [
      { fixtureId: target.fixtureId, marketKey: target.marketKey, selection: target.selection, active: true, capturedAt: new Date("2026-10-04T05:44:59.000Z") },
      { fixtureId: target.fixtureId, marketKey: target.marketKey, selection: target.selection, active: false, capturedAt: new Date("2026-10-04T05:46:00.000Z") },
      { fixtureId: target.fixtureId, marketKey: target.marketKey, selection: target.selection, active: true, capturedAt: kickoff }
    ])).toEqual([target]);
  });

  it("does not retry a target once an eligible active-bookmaker price is stored", () => {
    expect(missingOddsCoverageTargets([target], [{
      fixtureId: target.fixtureId, marketKey: target.marketKey, selection: target.selection, active: true, capturedAt: new Date("2026-10-04T05:46:00.000Z")
    }])).toEqual([]);
  });
});
