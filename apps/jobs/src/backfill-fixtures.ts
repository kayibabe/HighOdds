import { db } from "@highodds/db";
import { ApiFootballClient } from "./api-football.js";
import { ingestFixtures } from "./ingestion.js";

export interface BackfillResult { datesProcessed: number; skipped: number; ingested: number; rejected: number; }

async function wasAlreadyFetched(date: string): Promise<boolean> {
  const existing = await db.rawProviderPayload.findFirst({ where: { endpoint: "/fixtures", requestKey: `/fixtures:date=${date}` }, select: { id: true } });
  return existing !== null;
}

/**
 * Ingests one /fixtures snapshot per UTC date in [from, to), oldest first, reusing the exact
 * normalization INGEST_FIXTURES uses for "today". TRAIN_MODEL needs 365 days of FINISHED
 * fixtures (minimum 50 per competition), which the daily job alone can never accumulate on a
 * fresh database -- this fills that history in one pass.
 *
 * Skips any date that already has a captured /fixtures payload, so re-running the same range
 * after a QuotaSafetyError (or just to fill in the rest of a huge range across several days)
 * doesn't re-spend quota on dates that already succeeded -- only actually genuinely resumes.
 */
export async function backfillFixtures(
  from: Date,
  to: Date,
  client: Pick<ApiFootballClient, "getPaged"> = new ApiFootballClient(),
  ingest: (records: unknown[]) => Promise<{ ingested: number; rejected: number }> = ingestFixtures,
  alreadyFetched: (date: string) => Promise<boolean> = wasAlreadyFetched
): Promise<BackfillResult> {
  let datesProcessed = 0; let skipped = 0; let ingested = 0; let rejected = 0;
  for (const cursor = new Date(from); cursor < to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    if (await alreadyFetched(date)) { skipped += 1; continue; }
    const fixtures = await client.getPaged("/fixtures", { date });
    const result = await ingest(fixtures);
    ingested += result.ingested;
    rejected += result.rejected;
    datesProcessed += 1;
  }
  return { datesProcessed, skipped, ingested, rejected };
}
