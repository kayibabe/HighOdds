import { ApiFootballClient } from "./api-football.js";
import { ingestFixtures, ingestOdds } from "./ingestion.js";
import { captureOddsCoverage } from "./odds-coverage.js";
import { claimDueJobs, completeJob, ensureDailyJobs, failAndReleaseJob, requeueExpiredLeases } from "./schedule.js";
import { NoTrainingDataError, assertTrainedAny, trainModel } from "./train.js";
import { publishTickets } from "./publish.js";
import { refreshFinishedFixtures, refreshPendingResults, settleResults } from "./settle.js";

const EXECUTION_TIMEOUT_MS = 4 * 60 * 1000;
// Missing history won't fix itself within minutes; retry hourly so training resumes on its own after a backfill.
const NO_TRAINING_DATA_RETRY_MS = 60 * 60 * 1000;
const deadline = Date.now() + EXECUTION_TIMEOUT_MS;

async function execute(job: { jobType: string }): Promise<Record<string, number> | undefined> {
  const client = new ApiFootballClient();
  const date = new Date().toISOString().slice(0, 10);
  switch (job.jobType) {
    case "INGEST_FIXTURES": {
      const fixtures = await client.getPaged("/fixtures", { date });
      await ingestFixtures(fixtures);
      return;
    }
    case "INGEST_ODDS": {
      const odds = await client.getPaged("/odds", { date });
      await ingestOdds(odds);
      return;
    }
    case "VERIFY_ODDS_COVERAGE": {
      const result = await captureOddsCoverage(new Date(), client);
      console.log(`VERIFY_ODDS_COVERAGE forecasts=${result.forecasts} checked=${result.checked} retried=${result.retried} captured=${result.captured} remaining=${result.remaining}`);
      return { ...result };
    }
    case "TRAIN_MODEL": {
      const result = await trainModel(new Date());
      console.log(`TRAIN_MODEL trained=${result.trained} skipped=${result.skipped}`);
      assertTrainedAny(result);
      return;
    }
    case "PUBLISH_TICKETS": {
      const result = await publishTickets(new Date());
      console.log(`PUBLISH_TICKETS predicted=${result.predicted} predictionsSkipped=${result.predictionsSkipped} published=${result.published}`);
      return;
    }
    case "SETTLE_RESULTS": {
      // Settlement only reads the database, so a failed refresh (e.g. the shared key's daily limit)
      // must not hold back tickets the stored results already decide; the job still retries.
      const settleNow = new Date();
      const refreshError = await refreshPendingResults(settleNow, client).then(() => null, (error: unknown) => error);
      await settleResults(settleNow);
      if (refreshError) throw refreshError;
      return;
    }
    default: throw new Error(`Unsupported job type: ${job.jobType}`);
  }
}

async function main(): Promise<void> {
  const now = new Date();
  await ensureDailyJobs(now);
  await requeueExpiredLeases(now);
  const jobs = await claimDueJobs(now);
  for (const job of jobs) {
    if (Date.now() >= deadline - 15_000) {
      await failAndReleaseJob(job.id, new Error("Execution deadline reached before job start"), 0);
      continue;
    }
    try {
      const result = await execute(job);
      await completeJob(job.id, result);
    } catch (error) {
      console.error(`${job.jobType} failed:`, error instanceof Error ? error.message : error);
      await failAndReleaseJob(job.id, error, error instanceof NoTrainingDataError ? NO_TRAINING_DATA_RETRY_MS : undefined);
    }
  }
  await settleFinishedMatches();
}

/** Every tick, not a daily job: picks up full-time results within minutes and settles what they complete. */
async function settleFinishedMatches(): Promise<void> {
  if (Date.now() >= deadline - 30_000) return;
  const now = new Date();
  let refresh = { requested: 0, refreshed: 0 };
  try {
    refresh = await refreshFinishedFixtures(now);
  } catch (error) {
    // Keep going: settlement only needs the database, and results already stored may decide tickets.
    console.error("LIVE_SETTLE refresh failed:", error instanceof Error ? error.message : error);
  }
  try {
    const settle = await settleResults(now);
    if (refresh.requested > 0 || settle.settled > 0) console.log(`LIVE_SETTLE requested=${refresh.requested} refreshed=${refresh.refreshed} settled=${settle.settled} pending=${settle.pending}`);
  } catch (error) {
    console.error("LIVE_SETTLE settle failed:", error instanceof Error ? error.message : error);
  }
}

try { await main(); } catch (error) { console.error(error); process.exitCode = 1; }
