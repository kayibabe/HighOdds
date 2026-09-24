import { describe, expect, it } from "vitest";
import { fixtureStatus } from "../src/ingestion.js";

describe("fixtureStatus", () => {
  it("maps canonical API-Football short codes", () => {
    expect(fixtureStatus("FT")).toBe("FINISHED");
    expect(fixtureStatus("PEN")).toBe("FINISHED");
    expect(fixtureStatus("PST")).toBe("POSTPONED");
    expect(fixtureStatus("CANC")).toBe("CANCELLED");
    expect(fixtureStatus("2H")).toBe("LIVE");
    expect(fixtureStatus("NS")).toBe("SCHEDULED");
    expect(fixtureStatus(undefined)).toBe("SCHEDULED");
  });

  it("accepts non-canonical spellings seen in live payloads", () => {
    // Captured from /fixtures?date=2025-10-14: {"long":"Match Cancelled","short":"Canc"}
    expect(fixtureStatus("Canc")).toBe("CANCELLED");
    expect(fixtureStatus("Abandoned")).toBe("POSTPONED");
    expect(fixtureStatus("INT")).toBe("LIVE");
  });
});
