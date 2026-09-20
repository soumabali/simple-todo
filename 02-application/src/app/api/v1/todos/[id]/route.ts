import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { tasks } from "@/db/schema";
import { withApi, preflight, serializeTask, todayIn, assertDate } from "@/lib/api-v1";
import { ApiError } from "@/lib/session";
import {
  getOwnedTask,
  rescheduleTaskReminders,
  cancelTaskReminders,
  updateTaskSchedule,
  updateTaskReminders,
} from "@/lib/domain";

type Params = { id: string };

/** GET /api/v1/todos/:id — a single task. */
export const GET = withApi<Params>(async ({ db, principal }, _req, { id }) => {
  const task = await getOwnedTask(db, id, principal.userId);
  const today = await todayFor(db, principal.userId);
  return NextResponse.json({ todo: serializeTask(task, today) });
});

/**
 * PATCH /api/v1/todos/:id — partial update.
 *
 * Body: any of title, description, priority (1–4), progress (0–100),
 *       startDate, dueDate, dueTime, statusId, completed, remindOnStart,
 *       remindersMuted, remindLeadMinutes.
 *
 * Moving to a column whose status is “done” marks the task complete (and
 * cancels reminders); moving out of it reopens the task.
 */
export const PATCH = withApi<Params>(
  async ({ db, principal }, req, { id }) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const task = await getOwnedTask(db, id, principal.userId);

    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) throw new ApiError("BAD_REQUEST", "title cannot be empty");
      patch.title = title;
    }
    if (body.description !== undefined) {
      patch.description = body.description === null ? null : String(body.description);
    }
    if (body.priority !== undefined) {
      const prio = Number(body.priority);
      if (!Number.isInteger(prio) || prio < 1 || prio > 4) {
        throw new ApiError("BAD_REQUEST", "priority must be 1–4");
      }
      patch.priority = prio;
    }
    if (body.progress !== undefined) {
      const prog = Number(body.progress);
      if (!Number.isFinite(prog) || prog < 0 || prog > 100) {
        throw new ApiError("BAD_REQUEST", "progress must be 0–100");
      }
      patch.progress = Math.round(prog);
    }

    // --- status / completion -------------------------------------------
    const wantsCompleted = body.completed === undefined ? null : Boolean(body.completed);
    const statusId = typeof body.statusId === "string" ? body.statusId : null;

    let movedStatus: { isDone: boolean } | null = null;
    if (statusId) {
      const status = await db.query.statuses.findFirst({
        where: (s, { eq: e }) => e(s.id, statusId),
      });
      if (!status) throw new ApiError("NOT_FOUND", "Status not found", 404);
      if (status.boardId !== task.boardId) {
        throw new ApiError("BAD_REQUEST", "Status does not belong to this board");
      }
      patch.statusId = statusId;
      movedStatus = { isDone: status.isDone };
    } else if (wantsCompleted !== null) {
      const doneStatus = await db.query.statuses.findFirst({
        where: (s, { eq: e, and: a }) => a(e(s.boardId, task.boardId), e(s.isDone, true)),
        orderBy: (s, { asc }) => asc(s.position),
      });

      if (wantsCompleted) {
        // Completing without naming a column → move to the board's done column.
        if (!doneStatus) {
          throw new ApiError("BAD_REQUEST", "This board has no column marked as done");
        }
        patch.statusId = doneStatus.id;
        movedStatus = { isDone: true };
      } else if (doneStatus && task.statusId === doneStatus.id) {
        // Reopening a task sitting in the done column must actually move it out,
        // otherwise the board still counts it as complete.
        const openStatus = await db.query.statuses.findFirst({
          where: (s, { eq: e, and: a, ne }) => a(e(s.boardId, task.boardId), ne(s.id, doneStatus.id)),
          orderBy: (s, { asc }) => asc(s.position),
        });
        if (openStatus) {
          patch.statusId = openStatus.id;
          movedStatus = { isDone: false };
        }
      }
    }

    const nowDone = movedStatus ? movedStatus.isDone : Boolean(task.completedAt);
    const becomingDone = movedStatus?.isDone === true && !task.completedAt;
    const becomingOpen = movedStatus !== null && !movedStatus.isDone && Boolean(task.completedAt);

    if (becomingDone) {
      patch.completedAt = new Date();
      if (body.progress === undefined) patch.progress = 100;
    } else if (becomingOpen) {
      patch.completedAt = null;
      if (body.progress === undefined) patch.progress = 0;
    }
    // Direct completion toggle with no status change.
    if (movedStatus === null && wantsCompleted !== null && Boolean(task.completedAt) !== wantsCompleted) {
      patch.completedAt = wantsCompleted ? new Date() : null;
      if (body.progress === undefined) patch.progress = wantsCompleted ? 100 : 0;
    }

    await db.update(tasks).set(patch).where(eq(tasks.id, id)).returning();

    // --- schedule / reminders ------------------------------------------
    if (body.startDate !== undefined || body.dueDate !== undefined || body.dueTime !== undefined) {
      await updateTaskSchedule(db, principal.userId, id, {
        startDate: assertDate(body.startDate, "startDate"),
        dueDate: assertDate(body.dueDate, "dueDate"),
        dueTime: body.dueTime === null ? null : typeof body.dueTime === "string" ? body.dueTime : undefined,
      });
    }

    if (Object.keys(body).some((k) => ["remindOnStart", "remindersMuted", "remindLeadMinutes"].includes(k))) {
      await updateTaskReminders(db, principal.userId, id, {
        remindOnStart: body.remindOnStart === undefined ? undefined : Boolean(body.remindOnStart),
        muted: body.remindersMuted === undefined ? undefined : Boolean(body.remindersMuted),
        leadMinutes:
          body.remindLeadMinutes === undefined
            ? undefined
            : body.remindLeadMinutes === null
              ? null
              : Number(body.remindLeadMinutes),
      });
    }

    if (becomingDone) {
      await cancelTaskReminders(db, id);
    } else if (becomingOpen || nowDone === false) {
      await rescheduleTaskReminders(db, id);
    }

    const fresh = await getOwnedTask(db, id, principal.userId);
    const today = await todayFor(db, principal.userId);
    return NextResponse.json({ todo: serializeTask(fresh, today) });
  },
  "write"
);

/** DELETE /api/v1/todos/:id */
export const DELETE = withApi<Params>(
  async ({ db, principal }, _req, { id }) => {
    await getOwnedTask(db, id, principal.userId);
    await db.delete(tasks).where(eq(tasks.id, id));
    return NextResponse.json({ deleted: id });
  },
  "write"
);

export const OPTIONS = () => preflight();

async function todayFor(db: any, userId: string): Promise<string> {
  const user = await db.query.user.findFirst({
    where: (u: any, { eq: e }: any) => e(u.id, userId),
    columns: { timezone: true },
  });
  return todayIn(user?.timezone ?? "Asia/Makassar");
}
