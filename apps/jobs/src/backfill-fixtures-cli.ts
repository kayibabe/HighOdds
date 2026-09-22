import { backfillFixtures } from "./backfill-fixtures.js";
import { QuotaSafetyError } from "./api-football.js";

function utcDateOnly(date: Date): Date { return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`); }

const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
const days = daysArg ? Number(daysArg.split("=")[1]) : 365;
if (!Number.isInteger(days) || days <= 0) throw new Error(`--days must be a positive integer, got ${daysArg}`);

// Excludes today: the daily INGEST_FIXTURES job already owns today's date.
const to = utcDateOnly(new Date());
const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

try {
  const result = await backfillFixtures(from, to);
  console.log(JSON.stringify(result));
} catch (error) {
  if (error instanceof QuotaSafetyError) {
    console.error(`Stopped early: ${error.message}. Re-run the same command tomorrow -- dates already fetched are skipped, so it resumes from where the quota ran out.`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
