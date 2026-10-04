import { beforeEach, describe, expect, it, vi } from "vitest";
const { upsert } = vi.hoisted(() => ({ upsert: vi.fn().mockResolvedValue({}) }));
vi.mock("@highodds/db", () => ({ db: { jobRun: { upsert } } }));
import { ensureDailyJobs } from "../src/schedule.js";

describe("rolling fixture jobs", () => {
  beforeEach(() => upsert.mockClear());
  it("keeps the existing daily pipeline and queues every UTC boundary date once", async () => {
    await ensureDailyJobs(new Date("2026-10-04T12:00:00Z"));
    const jobs = upsert.mock.calls.map(([args]) => args.create);
    const fixtureJobs = jobs.filter((job) => job.jobType === "INGEST_FIXTURES");
    expect(fixtureJobs).toHaveLength(8);
    expect(new Set(fixtureJobs.map((job) => job.idempotencyKey)).size).toBe(8);
    expect(fixtureJobs.map((job) => job.payload?.fixtureDate ?? "2026-10-04").sort()).toEqual([
      "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"
    ]);
    expect(jobs.filter((job) => job.jobType === "PUBLISH_TICKETS")).toHaveLength(1);
    const evening = jobs.find((job) => job.jobType === "EVENING_FORECAST");
    expect(evening.runAfter.toISOString()).toBe("2026-10-04T20:00:00.000Z");
    expect(evening.payload).toEqual({ targetDate: "2026-10-05" });
    expect(upsert.mock.calls.every(([args]) => Object.keys(args.update).length === 0)).toBe(true);
  });
  it("uses stable keys on retry but refreshes the overlapping dates the following day", async () => {
    await ensureDailyJobs(new Date("2026-12-31T12:00:00Z"));
    const first = upsert.mock.calls.map(([args]) => args.where.idempotencyKey);
    upsert.mockClear();
    await ensureDailyJobs(new Date("2026-12-31T13:00:00Z"));
    expect(upsert.mock.calls.map(([args]) => args.where.idempotencyKey)).toEqual(first);
    upsert.mockClear();
    await ensureDailyJobs(new Date("2027-01-01T12:00:00Z"));
    const next = upsert.mock.calls.map(([args]) => args.where.idempotencyKey);
    expect(next.every((key) => !first.includes(key))).toBe(true);
    expect(next).toContain("INGEST_FIXTURES:calendar-v1:2027-01-01:2027-01-07");
    expect(upsert.mock.calls.find(([args]) => args.create.jobType === "EVENING_FORECAST")![0].create.payload).toEqual({ targetDate: "2027-01-02" });
  });
});
