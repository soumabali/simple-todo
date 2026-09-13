import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { and, eq, lte, sql } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { buildPushHTTPRequest } from "@pushforge/builder";
import {
  classifyDeliveryStatus,
  backoffMinutes,
  MAX_DELIVERY_ATTEMPTS,
  MAX_SUBSCRIPTION_FAILURES,
} from "../../src/lib/push-delivery";

/// <reference types="@cloudflare/workers-types" />

/**
 * flowboard-reminder — Cloudflare Worker with a Cron Trigger (PRD §8.5).
 *
 * Every 5 minutes it scans notification_queue for due, pending rows and
 * delivers them as Web Push. It runs on workerd, so it uses
 * @neondatabase/serverless (HTTP) and @pushforge/builder (Web Crypto).
 *
 * Deployed from the same repo, configured in workers/reminder/wrangler.jsonc.
 *
 * Duplicate-send protection (PRD §15):
 *  1. Cloudflare Cron Triggers are single-flight — a run still in progress
 *     when the next is scheduled is skipped, not overlapped.
 *  2. The Neon HTTP driver has no interactive transactions (transaction()
 *     throws "No transactions support"), so a true `FOR UPDATE SKIP LOCKED`
 *     claim is not possible here. Instead every status transition is
 *     CONDITIONAL — `UPDATE ... WHERE status='pending'` — so even if two
 *     invocations did overlap, only one can transition a given row out of
 *     `pending`. The losing UPDATE affects 0 rows and that row is skipped.
 *  3. The `(task_id, kind)` unique key + `sent`/`failed` terminal states
 *     make re-scheduling idempotent.
 */

export interface Env {
  DATABASE_URL: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string; // JWK JSON string
  VAPID_SUBJECT: string;
}

const BATCH = 200;

export async function runReminder(env: Env) {
  const sqlClient = neon(env.DATABASE_URL);
  const db = drizzle(sqlClient, { schema });
  const nq = schema.notificationQueue;
  const push = schema.pushSubscriptions;

  // 1. Select due, pending rows. The claim is made durable by the conditional
  //    `WHERE status='pending'` on every status transition below (defense in
  //    depth — see header note), not by a row lock.
  const due = await db
    .select()
    .from(nq)
    .where(and(eq(nq.status, "pending"), lte(nq.scheduledFor, new Date())))
    .orderBy(sql`${nq.scheduledFor} ASC`)
    .limit(BATCH);

  let processed = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of due) {
    processed++;

    // a. Task still exists, not complete, not muted?
    const task = await db.query.tasks.findFirst({
      where: (t, { eq: e }) => e(t.id, row.taskId),
    });
    if (!task || task.completedAt || task.remindersMuted) {
      const res = await db
        .update(nq)
        .set({ status: "cancelled" })
        .where(and(eq(nq.id, row.id), eq(nq.status, "pending")));
      if (res.rowCount) skipped++;
      continue;
    }

    // b. Push disabled → cancel (quiet-hours shifting already happened at
    //    schedule time in src/lib/reminders.ts; the cron only re-checks the
    //    global toggle so a user who turns push off stops getting pings).
    const settings = await db.query.notificationSettings.findFirst({
      where: (n, { eq: e }) => e(n.userId, row.userId),
    });
    if (settings && !settings.pushEnabled) {
      await db
        .update(nq)
        .set({ status: "cancelled" })
        .where(and(eq(nq.id, row.id), eq(nq.status, "pending")));
      skipped++;
      continue;
    }

    // c. Load subscriptions.
    const subs = await db.query.pushSubscriptions.findMany({
      where: (p, { eq: e }) => e(p.userId, row.userId),
    });

    const board = await db.query.boards.findFirst({
      where: (b, { eq: e }) => e(b.id, task.boardId),
    });

    const payload = {
      title: titleFor(row.kind, task.title),
      body: `Board: ${board?.name ?? ""} · Due ${task.dueDate ?? "—"}`,
      tag: `task-${task.id}-${row.kind}`,
      data: { url: `/boards/${task.boardId}?task=${task.id}` },
    };

    let anySuccess = false;

    for (const sub of subs) {
      if (sub.failureCount >= MAX_SUBSCRIPTION_FAILURES) continue; // deactivated (PRD §M7)

      let outcome: ReturnType<typeof classifyDeliveryStatus>;
      let lastStatus = 0;

      try {
        const request = await buildPushHTTPRequest({
          privateJWK: env.VAPID_PRIVATE_KEY,
          subscription: {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          message: {
            payload,
            adminContact: env.VAPID_SUBJECT,
            options: { ttl: 3600, urgency: "normal", topic: payload.tag },
          },
        });

        const res = await (globalThis.fetch as (input: string, init?: any) => Promise<Response>)(
          request.endpoint,
          { method: "POST", headers: request.headers as Headers, body: request.body }
        );
        lastStatus = res.status;
        outcome = classifyDeliveryStatus(res.status);
      } catch {
        // Network-level failure → treat as transient retry.
        outcome = "retry";
        lastStatus = 0;
      }

      if (outcome === "success") {
        anySuccess = true;
        await db
          .update(push)
          .set({ failureCount: 0, lastSuccessAt: new Date() })
          .where(eq(push.id, sub.id));
      } else if (outcome === "dead") {
        // 404/410 — device gone (e.g. PWA removed from home screen) → delete.
        await db.delete(push).where(eq(push.id, sub.id));
      } else {
        // retry
        failed++;
        await db
          .update(push)
          .set({ failureCount: sub.failureCount + 1 })
          .where(eq(push.id, sub.id));

        const attempts = row.attempts + 1;
        if (attempts >= MAX_DELIVERY_ATTEMPTS) {
          await db
            .update(nq)
            .set({ status: "failed", attempts, lastError: `HTTP ${lastStatus}` })
            .where(and(eq(nq.id, row.id), eq(nq.status, "pending")));
        } else {
          await db
            .update(nq)
            .set({
              attempts,
              lastError: `HTTP ${lastStatus}`,
              scheduledFor: new Date(Date.now() + backoffMinutes(attempts) * 60 * 1000),
            })
            .where(and(eq(nq.id, row.id), eq(nq.status, "pending")));
        }
      }
    }

    // e. Mark sent if at least one device succeeded (or no devices at all),
    //    so the row still appears in the in-app notification centre (PRD §8.5).
    //    Conditional update = the atomic claim.
    if (anySuccess || subs.length === 0) {
      const res = await db
        .update(nq)
        .set({ status: "sent", sentAt: new Date(), attempts: row.attempts })
        .where(and(eq(nq.id, row.id), eq(nq.status, "pending")));
      if (res.rowCount) sent++;
    }
  }

  console.log(JSON.stringify({ processed, sent, failed, skipped, at: new Date().toISOString() }));
}

function titleFor(kind: string, taskTitle: string): string {
  switch (kind) {
    case "start_soon":
      return `Time to start: ${taskTitle}`;
    case "due_soon":
      return `Due tomorrow: ${taskTitle}`;
    case "due_today":
      return `Due today: ${taskTitle}`;
    case "overdue":
      return `Overdue: ${taskTitle}`;
    default:
      return taskTitle;
  }
}

// Cloudflare Worker entry points.
export default {
  async scheduled(_controller: ScheduledController, env: Env) {
    await runReminder(env);
  },
};

// Manual trigger for local testing (optional).
export async function fetch(_req: Request, env: Env) {
  await runReminder(env);
  return new Response("reminder run complete", { status: 200 });
}
