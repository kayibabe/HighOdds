import { ApiFootballClient } from "./api-football.js";
import { ingestFixtures, ingestOdds } from "./ingestion.js";
import { claimDueJobs, completeJob, ensureDailyJobs, failAndReleaseJob, requeueExpiredLeases } from "./schedule.js";
import { trainModel } from "./train.js";
import { publishTickets } from "./publish.js";
import { refreshPendingResults, settleResults } from "./settle.js";

const EXECUTION_TIMEOUT_MS = 4 * 60 * 1000;
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
    case "TRAIN_MODEL":
      await trainModel(new Date());
      return;
    case "PUBLISH_TICKETS":
      await publishTickets(new Date());
      return;
    case "SETTLE_RESULTS": {
      const settleNow = new Date();
      await refreshPendingResults(settleNow, client);
      await settleResults(settleNow);
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
      await failAndReleaseJob(job.id, error);
    }
  }
}

try { await main(); } catch (error) { console.error(error); process.exitCode = 1; }
