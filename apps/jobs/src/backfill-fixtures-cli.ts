import { backfillFixtures } from "./backfill-fixtures.js";

function utcDateOnly(date: Date): Date { return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`); }

const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
const days = daysArg ? Number(daysArg.split("=")[1]) : 365;
if (!Number.isInteger(days) || days <= 0) throw new Error(`--days must be a positive integer, got ${daysArg}`);

// Excludes today: the daily INGEST_FIXTURES job already owns today's date.
const to = utcDateOnly(new Date());
const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

// If the provider stops it early (e.g. the shared key's daily limit), re-run the same command:
// dates already fetched are skipped, so it resumes where it stopped.
const result = await backfillFixtures(from, to);
console.log(JSON.stringify(result));
