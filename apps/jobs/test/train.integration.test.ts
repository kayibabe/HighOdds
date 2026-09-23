import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@highodds/db";
import { NoTrainingDataError, assertTrainedAny, trainModel } from "../src/train.js";
import { failAndReleaseJob } from "../src/schedule.js";

/**
 * Exercises the TRAIN_MODEL "no training data" path (#15) against a real local Postgres: trainModel
 * reads real FINISHED fixtures, assertTrainedAny turns an empty result into NoTrainingDataError, and
 * failAndReleaseJob persists that message to JobRun.lastError with the hourly retry run-due.ts uses.
 * See ingestion.integration.test.ts for the synthetic-ID/`_test`-database safety rationale.
 *
 * trainModel scans every competition in the database, and the test database accumulates permanent
 * competitions from the other suites. Each scenario therefore picks a `now` whose 365-day lookback
 * no other suite ever writes FINISHED fixtures into (other suites use 2026 onwards).
 */
const databaseUrl = process.env.DATABASE_URL;
const isTestDatabase = !!databaseUrl && /\/[^/?]*_test(\?|$)/.test(databaseUrl);

// Matches NO_TRAINING_DATA_RETRY_MS in run-due.ts, which isn't exported (importing run-due runs the job loop).
const NO_TRAINING_DATA_RETRY_MS = 60 * 60 * 1000;

describe.skipIf(!databaseUrl)("TRAIN_MODEL training data (live DB)", () => {
  beforeAll(() => {
    if (!isTestDatabase) {
      throw new Error(
        `Refusing to run train.integration.test.ts against DATABASE_URL="${databaseUrl}": its database ` +
        `name must end with "_test" (e.g. highodds_test). This suite writes ModelRun/JobRun rows and must ` +
        `never run against a database that could hold real data.`
      );
    }
  });

  describe("no competition has enough FINISHED fixtures", () => {
    // Nothing in any suite has a kickoff in 1899-1900.
    const now = new Date("1900-01-01T05:00:00.000Z");
    let jobRunId: string | undefined;

    afterAll(async () => {
      if (jobRunId) await db.jobRun.deleteMany({ where: { id: jobRunId } });
    });

    it("trains nothing, fails visibly, and records the backfill hint on the JobRun", async () => {
      const competitionCount = await db.competition.count();
      const result = await trainModel(now);
      expect(result).toEqual({ trained: 0, skipped: competitionCount });
      expect(await db.modelRun.count({ where: { trainedUntil: now } })).toBe(0);

      let thrown: unknown;
      try { assertTrainedAny(result); } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(NoTrainingDataError);

      // Same persistence step run-due.ts performs for a failed TRAIN_MODEL job.
      const job = await db.jobRun.create({
        data: { idempotencyKey: `TRAIN_MODEL:test-${randomInt(1, 1_000_000_000)}`, jobType: "TRAIN_MODEL", runAfter: now, status: "RUNNING", attempts: 1, leaseExpiresAt: new Date() }
      });
      jobRunId = job.id;
      const before = Date.now();
      await failAndReleaseJob(job.id, thrown, NO_TRAINING_DATA_RETRY_MS);

      const stored = await db.jobRun.findUniqueOrThrow({ where: { id: job.id } });
      expect(stored.status).toBe("DUE");
      expect(stored.leaseExpiresAt).toBeNull();
      expect(stored.lastError).toBe((thrown as Error).message);
      expect(stored.lastError).toMatch(new RegExp(`all ${competitionCount} had fewer than 50 FINISHED fixtures.*jobs:backfill-fixtures`));
      expect(stored.runAfter.getTime()).toBeGreaterThanOrEqual(before + NO_TRAINING_DATA_RETRY_MS);
      expect(stored.runAfter.getTime()).toBeLessThanOrEqual(Date.now() + NO_TRAINING_DATA_RETRY_MS);
    });
  });

  describe("one competition has enough FINISHED fixtures", () => {
    const RUN_SEED = randomInt(1, 9_000);
    const BASE = 500_000_000 + RUN_SEED * 1000;
    // Spread over 1950-1974 so re-runs (or leftovers of an aborted run) don't share a lookback window.
    const now = new Date(Date.UTC(1950, 0, 1, 5, 0, 0) + RUN_SEED * 24 * 60 * 60 * 1000);
    const POOL_SIZE = 10;
    const HISTORY_TARGET = 50;
    let competitionId: string;
    const teamIds: string[] = [];

    beforeAll(async () => {
      const competition = await db.competition.create({ data: { providerId: BASE + 1, name: "Synthetic Train League", country: null } });
      competitionId = competition.id;
      for (let i = 0; i < POOL_SIZE; i += 1) {
        teamIds.push((await db.team.create({ data: { providerId: BASE + 10 + i, name: `Synthetic Train Team ${i}` } })).id);
      }
      const pairs: Array<[number, number]> = [];
      for (let i = 0; i < POOL_SIZE; i += 1) for (let j = i + 1; j < POOL_SIZE; j += 1) pairs.push([i, j]);
      while (pairs.length < HISTORY_TARGET) pairs.push(pairs[pairs.length - 45]!);
      let providerId = BASE + 100;
      for (const [index, [i, j]] of pairs.entries()) {
        await db.fixture.create({
          data: {
            providerId: providerId++, competitionId, homeTeamId: teamIds[i]!, awayTeamId: teamIds[j]!,
            kickoff: new Date(now.getTime() - (HISTORY_TARGET - index) * 24 * 60 * 60 * 1000),
            status: "FINISHED", homeGoals: (i + j) % 3, awayGoals: (i * j) % 2
          }
        });
      }
    });

    // Nothing here is referenced by a TicketLeg, so unlike the publish suite the whole graph can go.
    afterAll(async () => {
      await db.modelRun.deleteMany({ where: { trainedUntil: now } });
      if (competitionId) {
        await db.fixture.deleteMany({ where: { competitionId } });
        await db.competition.deleteMany({ where: { id: competitionId } });
      }
      if (teamIds.length > 0) await db.team.deleteMany({ where: { id: { in: teamIds } } });
    });

    it("trains exactly that competition, persists its ModelRun, and passes the guard", async () => {
      const competitionCount = await db.competition.count();
      const result = await trainModel(now);
      expect(result).toEqual({ trained: 1, skipped: competitionCount - 1 });
      expect(() => assertTrainedAny(result)).not.toThrow();

      const runs = await db.modelRun.findMany({ where: { trainedUntil: now } });
      expect(runs).toHaveLength(1);
      expect(runs[0]!.competitionId).toBe(competitionId);
      expect(runs[0]!.method).toBe("dixon-coles-ipf-v1");
      const artifact = runs[0]!.artifact as { teams: Record<string, unknown> };
      expect(Object.keys(artifact.teams).sort()).toEqual([...teamIds].sort());
    });

    it("does not count a FINISHED fixture older than the 365-day lookback", async () => {
      // One year and a day later, all 50 fixtures fall outside the lookback window.
      const later = new Date(now.getTime() + 366 * 24 * 60 * 60 * 1000);
      const result = await trainModel(later);
      expect(result.trained).toBe(0);
      expect(() => assertTrainedAny(result)).toThrow(NoTrainingDataError);
    });
  });
});
