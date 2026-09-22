import { ApiFootballClient } from "./api-football.js";
import { ingestFixtures } from "./ingestion.js";

export interface BackfillResult { datesProcessed: number; ingested: number; rejected: number; }

/**
 * Ingests one /fixtures snapshot per UTC date in [from, to), oldest first, reusing the exact
 * normalization INGEST_FIXTURES uses for "today". TRAIN_MODEL needs 365 days of FINISHED
 * fixtures (minimum 50 per competition), which the daily job alone can never accumulate on a
 * fresh database -- this fills that history in one pass. Each date is ingested as soon as it's
 * fetched, so a mid-run stop (e.g. QuotaSafetyError) still keeps every date processed so far.
 */
export async function backfillFixtures(
  from: Date,
  to: Date,
  client: Pick<ApiFootballClient, "getPaged"> = new ApiFootballClient(),
  ingest: (records: unknown[]) => Promise<{ ingested: number; rejected: number }> = ingestFixtures
): Promise<BackfillResult> {
  let datesProcessed = 0; let ingested = 0; let rejected = 0;
  for (const cursor = new Date(from); cursor < to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const fixtures = await client.getPaged("/fixtures", { date });
    const result = await ingest(fixtures);
    ingested += result.ingested;
    rejected += result.rejected;
    datesProcessed += 1;
  }
  return { datesProcessed, ingested, rejected };
}
