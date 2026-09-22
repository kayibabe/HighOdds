import { describe, expect, it } from "vitest";
import { backfillFixtures } from "../src/backfill-fixtures.js";

describe("backfillFixtures", () => {
  it("fetches and ingests exactly one date per day in [from, to), oldest first", async () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-04T00:00:00.000Z");
    const requestedDates: string[] = [];
    const ingestedBatches: unknown[][] = [];

    const client = { getPaged: async (_endpoint: string, query: Record<string, string | number | undefined>) => {
      requestedDates.push(String(query.date));
      return [{ id: query.date }];
    } };
    const ingest = async (records: unknown[]) => { ingestedBatches.push(records); return { ingested: records.length, rejected: 0 }; };

    const result = await backfillFixtures(from, to, client, ingest);

    expect(requestedDates).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(ingestedBatches).toHaveLength(3);
    expect(result).toEqual({ datesProcessed: 3, ingested: 3, rejected: 0 });
  });

  it("propagates errors from the client without swallowing progress already returned by the caller", async () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-03T00:00:00.000Z");
    let calls = 0;
    const client = { getPaged: async () => { calls += 1; if (calls === 2) throw new Error("quota exceeded"); return []; } };
    const ingest = async () => ({ ingested: 0, rejected: 0 });

    await expect(backfillFixtures(from, to, client, ingest)).rejects.toThrow("quota exceeded");
    expect(calls).toBe(2);
  });
});
