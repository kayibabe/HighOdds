import { db } from "@highodds/db";
import { DAILY_JOB_SCHEDULE, JOB_LEASE_MINUTES, JOB_RETRY_MINUTES } from "@highodds/core";

const RETRY_MS = JOB_RETRY_MINUTES * 60 * 1000;
const LEASE_MS = JOB_LEASE_MINUTES * 60 * 1000;

export interface ClaimedJob { id: string; idempotencyKey: string; jobType: string; payload: unknown; attempts: number; }

/** Creates idempotent daily jobs in UTC. 08:00 Africa/Blantyre is 06:00 UTC. */
export async function ensureDailyJobs(now: Date): Promise<void> {
  const targetDate = now.toISOString().slice(0, 10);
  const jobs = DAILY_JOB_SCHEDULE.map((job) => ({ jobType: job.jobType, runAfter: new Date(`${targetDate}T${job.utcTime}:00.000Z`) }));
  for (const job of jobs) {
    await db.jobRun.upsert({ where: { idempotencyKey: `${job.jobType}:${targetDate}` }, create: { idempotencyKey: `${job.jobType}:${targetDate}`, jobType: job.jobType, runAfter: job.runAfter }, update: {} });
  }
}

export async function requeueExpiredLeases(now: Date): Promise<number> {
  const result = await db.jobRun.updateMany({ where: { status: "RUNNING", leaseExpiresAt: { lt: now } }, data: { status: "DUE", claimedAt: null, leaseExpiresAt: null, lastError: "Lease expired; requeued" } });
  return result.count;
}

/** Claims jobs with PostgreSQL SKIP LOCKED so concurrent/crashed cron runs cannot double execute. */
export async function claimDueJobs(now: Date, limit = 10): Promise<ClaimedJob[]> {
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  return db.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "JobRun"
      WHERE status = 'DUE' AND "runAfter" <= ${now}
      ORDER BY "runAfter" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}`;
    if (candidates.length === 0) return [];
    const ids = candidates.map((candidate) => candidate.id);
    await tx.jobRun.updateMany({ where: { id: { in: ids }, status: "DUE" }, data: { status: "RUNNING", claimedAt: now, leaseExpiresAt, attempts: { increment: 1 } } });
    return tx.jobRun.findMany({ where: { id: { in: ids }, status: "RUNNING" }, select: { id: true, idempotencyKey: true, jobType: true, payload: true, attempts: true } });
  });
}

export async function completeJob(id: string): Promise<void> { await db.jobRun.update({ where: { id }, data: { status: "DONE", completedAt: new Date(), leaseExpiresAt: null } }); }
export async function failAndReleaseJob(id: string, error: unknown, retryAfterMs = RETRY_MS): Promise<void> {
  await db.jobRun.update({ where: { id }, data: { status: "DUE", runAfter: new Date(Date.now() + retryAfterMs), leaseExpiresAt: null, lastError: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000) } });
}
