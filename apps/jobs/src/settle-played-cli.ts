import { db } from "@highodds/db";
import { QuotaSafetyError } from "./api-football.js";
import { refreshStaleFixtures, settleResults } from "./settle.js";

// Re-fetches final results for every past fixture still SCHEDULED/LIVE, then settles any locked
// tickets those results unblock. Safe to re-run: settlement inserts at most one row per ticket.
try {
  const now = new Date();
  const refresh = await refreshStaleFixtures(now);
  const settle = await settleResults(now);
  const remaining = await db.fixture.groupBy({ by: ["status"], where: { kickoff: { lt: now } }, _count: true });
  console.log(JSON.stringify({ refresh, settle, pastFixturesByStatus: Object.fromEntries(remaining.map((row) => [row.status, row._count])) }));
} catch (error) {
  if (error instanceof QuotaSafetyError) {
    console.error(`Stopped early: ${error.message}. Re-run once quota resets; completed dates are already saved.`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
