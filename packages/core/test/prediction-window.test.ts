import { describe, expect, it } from "vitest";
import { forecastStageLabel, predictionWindow, tomorrowForecastDate } from "../src/prediction-window.js";
import { highProbabilityPick } from "../src/forecast-evidence.js";

describe("evening forecast window", () => {
  const evening = new Date("2026-10-04T20:00:00Z");
  it("covers tomorrow's entire local day, including late games beyond 20 hours", () => {
    const window = predictionWindow(evening, { stage: "PRELIMINARY", targetDate: "2026-10-05" });
    expect(window.gte.toISOString()).toBe("2026-10-04T22:00:00.000Z");
    expect(window.lt?.toISOString()).toBe("2026-10-05T22:00:00.000Z");
    expect(new Date("2026-10-05T21:00:00Z") > predictionWindow(evening).lte!).toBe(true);
  });
  it("pins a retry to the original day and excludes already started fixtures", () => {
    const retry = new Date("2026-10-05T01:00:00Z");
    expect(predictionWindow(retry, { stage: "PRELIMINARY", targetDate: "2026-10-05" })).toEqual({ gte: retry, lt: new Date("2026-10-05T22:00:00Z") });
    const expired = predictionWindow(new Date("2026-10-06T03:00:00Z"), { stage: "PRELIMINARY", targetDate: "2026-10-05" });
    expect(expired.gte > expired.lt!).toBe(true);
  });
  it("retains the inclusive 20-hour selection window and rejects malformed dates", () => {
    expect(predictionWindow(evening)).toEqual({ gte: evening, lte: new Date("2026-10-05T16:00:00Z") });
    expect(() => predictionWindow(evening, { stage: "PRELIMINARY", targetDate: "2026-02-30" })).toThrow("Invalid");
  });
  it("resolves tomorrow across local midnight and year boundaries", () => {
    expect(tomorrowForecastDate(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
    expect(tomorrowForecastDate(new Date("2026-12-31T23:00:00Z"))).toBe("2027-01-02");
  });
});

describe("forecast stage precedence", () => {
  const kickoff = new Date("2026-10-05T18:00:00Z");
  const now = new Date("2026-10-05T06:00:00Z");
  const preliminary = { marketKey: "MATCH_WINNER", selection: "HOME", probability: 0.99,
    trainedUntil: new Date("2026-10-04T05:00:00Z"), asOfAt: new Date("2026-10-04T20:00:00Z"), stage: "PRELIMINARY" };
  it("shows a labelled preliminary pick before a selection-window forecast exists", () => {
    expect(highProbabilityPick([preliminary], kickoff, now, 90)).toBe(preliminary);
    expect(forecastStageLabel(preliminary.stage)).toBe("Preliminary");
  });
  it("does not fall back to an optimistic preview when the morning forecast fails filters", () => {
    const morning = { ...preliminary, stage: "SELECTION", probability: 0.6, asOfAt: new Date("2026-10-05T05:45:00Z") };
    expect(highProbabilityPick([preliminary, morning], kickoff, now, 90)).toBeNull();
    expect(highProbabilityPick([preliminary, morning], kickoff, now, 60)).toBe(morning);
  });
  it("ignores future or leaked selection forecasts rather than hiding an eligible preview", () => {
    const future = { ...preliminary, stage: "SELECTION", asOfAt: new Date("2026-10-05T07:00:00Z") };
    expect(highProbabilityPick([preliminary, future], kickoff, now, 90)).toBe(preliminary);
  });
});
