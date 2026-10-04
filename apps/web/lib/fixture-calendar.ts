import { db } from "@highodds/db";
import { blantyreToday, fixtureCalendar } from "@highodds/core";

export async function loadFixtureCalendar(now: Date) {
  const calendar = fixtureCalendar(now);
  const fixtures = await db.fixture.findMany({
    where: { kickoff: { gte: calendar.start, lt: calendar.end } },
    select: { kickoff: true, receivedAt: true }
  });
  const jobs = await db.jobRun.findMany({
    where: { jobType: "INGEST_FIXTURES", idempotencyKey: { in: calendar.providerDates.map((day) =>
      day === now.toISOString().slice(0, 10) ? `INGEST_FIXTURES:${day}` : `INGEST_FIXTURES:calendar-v1:${now.toISOString().slice(0, 10)}:${day}`) } },
    select: { status: true, completedAt: true }
  });
  return {
    days: calendar.days.map((day) => ({ day, count: fixtures.filter((fixture) => blantyreToday(fixture.kickoff) === day).length })),
    completed: jobs.filter((job) => job.status === "DONE").length,
    expected: calendar.providerDates.length,
    lastCompletedAt: jobs.reduce<Date | null>((latest, job) => job.completedAt && (!latest || job.completedAt > latest) ? job.completedAt : latest, null)
  };
}
