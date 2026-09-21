"use server";

import { revalidatePath } from "next/cache";
import { db } from "@highodds/db";
import { auth } from "../../auth";

async function requireAdmin(): Promise<{ id: string; email: string }> {
  const session = await auth();
  if (!session?.user?.email || session.user.role !== "ADMIN") throw new Error("Admin session required");
  const actor = await db.user.findUnique({ where: { email: session.user.email }, select: { id: true, email: true } });
  if (!actor) throw new Error("Admin session required");
  return actor;
}

async function audit(actorId: string, action: string, target: string, metadata: Record<string, unknown> = {}): Promise<void> {
  await db.auditLog.create({ data: { actorId, action, target, metadata: metadata as unknown as object } });
}

export async function extendSubscriber(formData: FormData): Promise<void> {
  const actor = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const base = user.activeTo && user.activeTo > new Date() ? user.activeTo : new Date();
  const activeTo = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);
  await db.user.update({ where: { id: userId }, data: { activeTo } });
  await audit(actor.id, "SUBSCRIBER_EXTENDED", userId, { activeTo: activeTo.toISOString() });
  revalidatePath("/admin");
}

export async function toggleAdminRole(formData: FormData): Promise<void> {
  const actor = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const demoting = user.role === "ADMIN";
  const role = demoting ? "SUBSCRIBER" : "ADMIN";

  if (demoting && userId === actor.id) {
    await audit(actor.id, "ROLE_CHANGE_BLOCKED", userId, { reason: "cannot revoke your own admin role" });
    revalidatePath("/admin");
    return;
  }
  if (demoting) {
    const adminCount = await db.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) {
      await audit(actor.id, "ROLE_CHANGE_BLOCKED", userId, { reason: "cannot revoke the last remaining admin" });
      revalidatePath("/admin");
      return;
    }
  }

  await db.user.update({ where: { id: userId }, data: { role } });
  await audit(actor.id, "ROLE_CHANGED", userId, { role });
  revalidatePath("/admin");
}

export async function retryJob(formData: FormData): Promise<void> {
  const actor = await requireAdmin();
  const jobId = String(formData.get("jobId") ?? "");
  const { count } = await db.jobRun.updateMany({
    where: { id: jobId, status: { notIn: ["RUNNING", "DONE"] } },
    data: { status: "DUE", runAfter: new Date(), leaseExpiresAt: null, claimedAt: null }
  });
  if (count === 0) {
    await audit(actor.id, "JOB_RETRY_BLOCKED", jobId, { reason: "job is running or already done" });
    revalidatePath("/admin");
    return;
  }
  await audit(actor.id, "JOB_RETRIED", jobId);
  revalidatePath("/admin");
}

export async function toggleBookmakerActive(formData: FormData): Promise<void> {
  const actor = await requireAdmin();
  const bookmakerId = String(formData.get("bookmakerId") ?? "");
  const bookmaker = await db.bookmaker.findUniqueOrThrow({ where: { id: bookmakerId } });
  const active = !bookmaker.active;
  await db.bookmaker.update({ where: { id: bookmakerId }, data: { active } });
  await audit(actor.id, active ? "BOOKMAKER_ACTIVATED" : "BOOKMAKER_DEACTIVATED", bookmakerId);
  revalidatePath("/admin");
}

export async function retrainNow(): Promise<void> {
  const actor = await requireAdmin();
  const now = new Date();
  const key = `TRAIN_MODEL:manual:${now.toISOString()}`;
  const job = await db.jobRun.create({ data: { idempotencyKey: key, jobType: "TRAIN_MODEL", runAfter: now } });
  await audit(actor.id, "MODEL_RETRAIN_REQUESTED", job.id);
  revalidatePath("/admin");
}
