import { ApiFootballClient } from "./api-football.js";
import { ingestFixtures, ingestOdds } from "./ingestion.js";
import { claimDueJobs, completeJob, ensureDailyJobs, failAndReleaseJob, requeueExpiredLeases } from "./schedule.js";
import { NoTrainingDataError, assertTrainedAny, trainModel } from "./train.js";
import { publishTickets } from "./publish.js";
import { refreshPendingResults, refreshStaleFixtures, settleResults } from "./settle.js";

const EXECUTION_TIMEOUT_MS = 4 * 60 * 1000;
// Covers the last week of fixtures; older ones the provider never resolved are left to `jobs:settle-played`.
const SETTLE_CATCH_UP_LOOKBACK_DAYS = 7;
// Missing history won't fix itself within minutes; retry hourly so training resumes on its own after a backfill.
const NO_TRAINING_DATA_RETRY_MS = 60 * 60 * 1000;
const deadline = Date.now() + EXECUTION_TIMEOUT_MS;

async function execute(job: { jobType: string }): Promise<void> {
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
      const settleNow = new Date();
      await refreshPendingResults(settleNow, client);
      const settled = await settleResults(settleNow);
      // Settle first so a quota stop in the wider catch-up can't hold up ticket settlement.
      const caughtUp = await refreshStaleFixtures(settleNow, client, { lookbackDays: SETTLE_CATCH_UP_LOOKBACK_DAYS });
      console.log(`SETTLE_RESULTS settled=${settled.settled} pending=${settled.pending} catchUpDates=${caughtUp.dates.length} refreshed=${caughtUp.refreshed} refreshedById=${caughtUp.refreshedById}`);
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
      await execute(job);
      await completeJob(job.id);
    } catch (error) {
      console.error(`${job.jobType} failed:`, error instanceof Error ? error.message : error);
      await failAndReleaseJob(job.id, error, error instanceof NoTrainingDataError ? NO_TRAINING_DATA_RETRY_MS : undefined);
    }
  }
}

try { await main(); } catch (error) { console.error(error); process.exitCode = 1; }
