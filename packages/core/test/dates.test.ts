import { describe, expect, it } from "vitest";
import { addDays, blantyreDayBounds, blantyreToday, parseIsoDay, resolveDayRange } from "../src/dates.js";

describe("parseIsoDay", () => {
  it("accepts real calendar days only", () => {
    expect(parseIsoDay("2026-09-24")).toBe("2026-09-24");
    expect(parseIsoDay("2024-02-29")).toBe("2024-02-29");
    expect(parseIsoDay("2026-02-29")).toBeNull();
    expect(parseIsoDay("2026-9-24")).toBeNull();
    expect(parseIsoDay(["2026-09-24"])).toBeNull();
    expect(parseIsoDay(undefined)).toBeNull();
  });
});

describe("day arithmetic", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
  });

  it("maps a Blantyre day to UTC+02:00 bounds", () => {
    const { start, end } = blantyreDayBounds("2026-09-24");
    expect(start.toISOString()).toBe("2026-09-23T22:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-24T22:00:00.000Z");
    expect(blantyreToday(new Date("2026-09-23T23:30:00Z"))).toBe("2026-09-24");
  });
});

describe("resolveDayRange", () => {
  const today = "2026-09-24";

  it("expands presets relative to today, inclusive", () => {
    expect(resolveDayRange({ range: "yesterday" }, today)).toEqual({ preset: "yesterday", from: "2026-09-23", to: "2026-09-23" });
    expect(resolveDayRange({ range: "7d" }, today)).toEqual({ preset: "7d", from: "2026-09-18", to: today });
    expect(resolveDayRange({ range: "365d" }, today)).toEqual({ preset: "365d", from: "2025-09-25", to: today });
    expect(resolveDayRange({ range: "all" }, today)).toEqual({ preset: "all", from: null, to: null });
  });

  it("falls back to the default preset for missing or unknown ranges", () => {
    expect(resolveDayRange({}, today).preset).toBe("30d");
    expect(resolveDayRange({ range: "forever" }, today, "7d").preset).toBe("7d");
  });

  it("prefers explicit dates, fills a missing bound, and swaps a reversed range", () => {
    expect(resolveDayRange({ range: "7d", from: "2025-01-01", to: "2025-01-31" }, today)).toEqual({ preset: "custom", from: "2025-01-01", to: "2025-01-31" });
    expect(resolveDayRange({ from: "2025-06-01" }, today)).toEqual({ preset: "custom", from: "2025-06-01", to: "2025-06-01" });
    expect(resolveDayRange({ from: "2025-06-10", to: "2025-06-01" }, today)).toEqual({ preset: "custom", from: "2025-06-01", to: "2025-06-10" });
  });
});
