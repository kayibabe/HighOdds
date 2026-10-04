import { describe, expect, it } from "vitest";
import { fixtureCalendar, providerDates } from "../src/fixture-calendar.js";

describe("fixture calendar", () => {
  it("covers seven local days including both UTC boundary dates", () => {
    const calendar = fixtureCalendar(new Date("2026-10-03T23:30:00Z"));
    expect(calendar.today).toBe("2026-10-04");
    expect(calendar.days).toEqual(["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]);
    expect(calendar.start.toISOString()).toBe("2026-10-03T22:00:00.000Z");
    expect(calendar.end.toISOString()).toBe("2026-10-10T22:00:00.000Z");
    expect(calendar.providerDates).toHaveLength(8);
    expect(calendar.providerDates[0]).toBe("2026-10-03");
    expect(calendar.providerDates[7]).toBe("2026-10-10");
  });
  it("rolls over the year and excludes an exact end midnight", () => {
    expect(fixtureCalendar(new Date("2026-12-31T23:00:00Z")).days[6]).toBe("2027-01-07");
    expect(providerDates(new Date("2026-12-31T23:00:00Z"), new Date("2027-01-02T00:00:00Z"))).toEqual(["2026-12-31", "2027-01-01"]);
  });
});
