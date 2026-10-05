import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@highodds/db", () => ({ db: { fixture: { findMany } } }));

import { refreshPublishedTicketOdds, ticketFixturesNeedingOddsRefresh } from "../src/ticket-odds-refresh.js";

const now = new Date("2026-10-05T10:00:00.000Z");
const publication = new Date("2026-10-05T08:00:00.000Z");
const fixture = (overrides: Partial<{ providerId: number; kickoff: Date; quotes: Array<{ capturedAt: Date }>; ticketLegs: Array<{ ticketVersion: { publishedAt: Date } }> }> = {}) => ({
  providerId: 101,
  kickoff: new Date("2026-10-05T12:00:00.000Z"),
  quotes: [{ capturedAt: new Date("2026-10-05T08:10:00.000Z") }],
  ticketLegs: [{ ticketVersion: { publishedAt: publication } }],
  ...overrides
});

describe("ticketFixturesNeedingOddsRefresh", () => {
  it("requires a post-publication observation, then refreshes only after the bounded cadence", () => {
    expect(ticketFixturesNeedingOddsRefresh(now, [
      fixture({ providerId: 1, quotes: [{ capturedAt: new Date("2026-10-05T07:59:59.000Z") }] }),
      fixture({ providerId: 2, quotes: [{ capturedAt: new Date("2026-10-05T09:45:00.000Z") }] }),
      fixture({ providerId: 3, quotes: [{ capturedAt: new Date("2026-10-05T09:20:00.000Z") }] })
    ]).map((row) => row.providerId)).toEqual([1, 3]);
  });
});

describe("refreshPublishedTicketOdds", () => {
  beforeEach(() => findMany.mockReset());

  it("requests only stale ticket fixtures and leaves immutable decisions untouched", async () => {
    findMany.mockResolvedValue([
      fixture({ providerId: 201, quotes: [{ capturedAt: new Date("2026-10-05T07:59:59.000Z") }] }),
      fixture({ providerId: 202, quotes: [{ capturedAt: new Date("2026-10-05T09:45:00.000Z") }] })
    ]);
    const getPaged = vi.fn().mockResolvedValue([{ fixture: { id: 201 } }]);
    const ingest = vi.fn().mockResolvedValue({ quotes: 4, rejected: 1 });

    await expect(refreshPublishedTicketOdds(now, { getPaged }, ingest)).resolves.toEqual({ eligible: 2, requested: 1, captured: 4, rejected: 1 });
    expect(getPaged).toHaveBeenCalledWith("/odds", { fixture: 201 });
    expect(ingest).toHaveBeenCalledWith([{ fixture: { id: 201 } }]);
    expect(findMany.mock.calls[0][0].where.ticketLegs.some.ticketVersion.successors).toEqual({ none: {} });
  });
});
