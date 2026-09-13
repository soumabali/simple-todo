import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  boards,
  statuses,
  tasks,
  taskLabels,
  notificationQueue,
  notificationSettings,
} from "@/db/schema";
import { ApiError } from "@/lib/session";
import { midpoint, needsRebalance, REBALANCE_STEP } from "@/lib/ordering";
import { computeReminders, type NotificationSettings } from "@/lib/reminders";

type DB = ReturnType<typeof getDb>;

/** Fetch a board, guaranteeing the caller owns it (else 404 per PRD §M2). */
export async function getOwnedBoard(db: DB, boardId: string, userId: string) {
  const board = await db.query.boards.findFirst({
    where: (b, { eq: e, and: a }) => a(e(b.id, boardId), e(b.userId, userId)),
  });
  if (!board) throw new ApiError("NOT_FOUND", "Board not found", 404);
  return board;
}

export async function getOwnedTask(db: DB, taskId: string, userId: string) {
  const task = await db.query.tasks.findFirst({
    where: (t, { eq: e }) => e(t.id, taskId),
  });
  if (!task) throw new ApiError("NOT_FOUND", "Task not found", 404);
  // Ownership is via the board.
  const board = await db.query.boards.findFirst({
    where: (b, { eq: e, and: a }) => a(e(b.id, task.boardId), e(b.userId, userId)),
  });
  if (!board) throw new ApiError("NOT_FOUND", "Task not found", 404);
  return task;
}

export async function getOwnedStatus(db: DB, statusId: string, userId: string) {
  const st = await db.query.statuses.findFirst({
    where: (s, { eq: e }) => e(s.id, statusId),
  });
  if (!st) throw new ApiError("NOT_FOUND", "Status not found", 404);
  const board = await db.query.boards.findFirst({
    where: (b, { eq: e, and: a }) => a(e(b.id, st.boardId), e(b.userId, userId)),
  });
  if (!board) throw new ApiError("NOT_FOUND", "Status not found", 404);
  return st;
}

/* =====================================================================
 * Reminder (re)scheduling — PRD §6.4 / §8.5
 * ===================================================================== */

/**
 * Delete pending rows and re-insert the current reminder set for a task.
 * Idempotency is guaranteed by the UNIQUE (task_id, kind) constraint.
 */
export async function rescheduleTaskReminders(db: DB, taskId: string) {
  const task = await db.query.tasks.findFirst({ where: (t, { eq: e }) => e(t.id, taskId) });
  if (!task) return;

  // Delete only pending rows — sent/history is preserved for the inbox.
  await db
    .delete(notificationQueue)
    .where(and(eq(notificationQueue.taskId, taskId), eq(notificationQueue.status, "pending")));

  const board = await db.query.boards.findFirst({
    where: (b, { eq: e }) => e(b.id, task.boardId),
  });
  if (!board) return;

  const settings = await getOrCreateNotificationSettings(db, board.userId);
  const owner = await db.query.user.findFirst({
    where: (u, { eq: e }) => e(u.id, board.userId),
  });
  const timezone = owner?.timezone ?? "Asia/Makassar";
  const reminders = computeReminders(
    {
      startDate: task.startDate,
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      remindOnStart: task.remindOnStart,
      remindLeadMinutes: task.remindLeadMinutes,
      remindersMuted: task.remindersMuted,
      completedAt: task.completedAt,
    },
    settings,
    timezone
  );

  if (reminders.length > 0) {
    // Upsert (ON CONFLICT (task_id, kind) DO UPDATE) so rescheduling
    // reactivates a previously cancelled/sent row back to `pending` rather
    // than violating the idempotency unique key (PRD §6.4).
    await db
      .insert(notificationQueue)
      .values(
        reminders.map((r) => ({
          userId: board.userId,
          taskId,
          kind: r.kind,
          scheduledFor: r.scheduledFor,
          status: "pending" as const,
        }))
      )
      .onConflictDoUpdate({
        target: [notificationQueue.taskId, notificationQueue.kind],
        set: {
          scheduledFor: sql`excluded.scheduled_for`,
          status: "pending",
          attempts: 0,
          lastError: null,
          sentAt: null,
          readAt: null,
        },
      });
  }
}

export async function cancelTaskReminders(db: DB, taskId: string) {
  await db
    .update(notificationQueue)
    .set({ status: "cancelled" })
    .where(and(eq(notificationQueue.taskId, taskId), eq(notificationQueue.status, "pending")));
}

async function getOrCreateNotificationSettings(db: DB, userId: string): Promise<NotificationSettings> {
  let s = await db.query.notificationSettings.findFirst({
    where: (n, { eq: e }) => e(n.userId, userId),
  });
  if (!s) {
    const [inserted] = await db
      .insert(notificationSettings)
      .values({ userId })
      .returning();
    s = inserted;
  }
  return {
    pushEnabled: s.pushEnabled,
    defaultTime: s.defaultTime,
    leadMinutesStart: s.leadMinutesStart,
    leadMinutesDue: s.leadMinutesDue,
    notifyDueToday: s.notifyDueToday,
    notifyOverdue: s.notifyOverdue,
    quietStart: s.quietStart,
    quietEnd: s.quietEnd,
  };
}

/* =====================================================================
 * Board operations
 * ===================================================================== */

const DEFAULT_STATUSES = [
  { name: "To Do", color: "slate", position: "1000", isDone: false },
  { name: "In Progress", color: "amber", position: "2000", isDone: false },
  { name: "Done", color: "emerald", position: "3000", isDone: true },
];

export async function createBoard(db: DB, userId: string, input: { name: string; description?: string; color?: string }) {
  const name = input.name.trim();
  if (!name) throw new ApiError("BAD_REQUEST", "Name is required");
  if (name.length > 60) throw new ApiError("BAD_REQUEST", "Name must be ≤ 60 characters");

  const [board] = await db
    .insert(boards)
    .values({
      userId,
      name,
      description: input.description ?? null,
      color: input.color ?? "indigo",
      position: "1000",
    })
    .returning();

  await db.insert(statuses).values(
    DEFAULT_STATUSES.map((s) => ({ ...s, boardId: board.id }))
  );

  return board;
}

/* =====================================================================
 * Task creation — computes initial position and schedules reminders.
 * ===================================================================== */

export async function createTask(
  db: DB,
  userId: string,
  input: {
    boardId: string;
    title: string;
    statusId: string;
    description?: string;
    priority?: number;
    startDate?: string | null;
    dueDate?: string | null;
    dueTime?: string | null;
    remindOnStart?: boolean;
    remindLeadMinutes?: number | null;
    remindersMuted?: boolean;
    labelIds?: string[];
  }
) {
  const title = input.title.trim();
  if (!title) throw new ApiError("BAD_REQUEST", "Title is required");

  await getOwnedBoard(db, input.boardId, userId);
  const status = await getOwnedStatus(db, input.statusId, userId);
  if (status.boardId !== input.boardId) {
    throw new ApiError("BAD_REQUEST", "Status does not belong to this board");
  }

  // Validate dates server-side (PRD §M4 date validation).
  if (input.startDate && input.dueDate && input.startDate > input.dueDate) {
    throw new ApiError("BAD_REQUEST", "Start date must be before or equal to due date");
  }

  // Position: append at the end of the column.
  const last = await db.query.tasks.findFirst({
    where: (t, { eq: e }) => e(t.statusId, input.statusId),
    orderBy: (t, { desc: d }) => d(t.position),
  });
  const position = (last ? Number(last.position) : 1000) + 1000;

  const [task] = await db
    .insert(tasks)
    .values({
      boardId: input.boardId,
      statusId: input.statusId,
      title,
      description: input.description ?? null,
      priority: input.priority ?? 2,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      dueTime: input.dueTime ?? null,
      remindOnStart: input.remindOnStart ?? true,
      remindLeadMinutes: input.remindLeadMinutes ?? null,
      remindersMuted: input.remindersMuted ?? false,
      position: String(position),
    })
    .returning();

  if (input.labelIds?.length) {
    await db.insert(taskLabels).values(input.labelIds.map((lid) => ({ taskId: task.id, labelId: lid })));
  }

  await rescheduleTaskReminders(db, task.id);
  return task;
}

/* =====================================================================
 * Move a task (between statuses / positions) — PRD §8.2
 * ===================================================================== */

export async function moveTask(
  db: DB,
  userId: string,
  taskId: string,
  input: { statusId: string; prevPosition: number | null; nextPosition: number | null }
) {
  const task = await getOwnedTask(db, taskId, userId);
  const status = await getOwnedStatus(db, input.statusId, userId);
  if (status.boardId !== task.boardId) {
    throw new ApiError("BAD_REQUEST", "Status does not belong to this board");
  }

  const position = midpoint(input.prevPosition, input.nextPosition);

  const isDone = status.isDone;
  const patch: Record<string, unknown> = {
    statusId: input.statusId,
    position: String(position),
  };

  if (isDone && !task.completedAt) {
    patch.progress = 100;
    patch.completedAt = new Date();
  } else if (!isDone && task.completedAt) {
    patch.completedAt = null;
    // progress recomputed if there are subtasks, else keep as-is (or reset to a sane value)
  }

  // If the midpoint gap is too small, rebalance the target column (PRD §6.2).
  if (
    input.prevPosition !== null &&
    input.nextPosition !== null &&
    needsRebalance(input.prevPosition, input.nextPosition)
  ) {
    const siblings = await db.query.tasks.findMany({
      where: (t, { eq: e }) => e(t.statusId, input.statusId),
      orderBy: (t, { asc: a }) => a(t.position),
    });
    // The dragged task may already be in this column; rebalance positions that
    // exist now (excluding the dragged task so we can slot it in cleanly).
    const others = siblings.filter((t) => t.id !== taskId);
    const combined = [...others, { id: taskId, position: input.prevPosition }]
      .sort((a, b) => Number(a.position) - Number(b.position));
    for (let i = 0; i < combined.length; i++) {
      const item = combined[i];
      const newPos = (i + 1) * REBALANCE_STEP;
      if (item.id === taskId) {
        patch.position = String(newPos);
      } else {
        await db.update(tasks).set({ position: String(newPos) }).where(eq(tasks.id, item.id));
      }
    }
  }

  const [updated] = await db.update(tasks).set(patch).where(eq(tasks.id, taskId)).returning();

  // Recompute progress from subtasks if needed.
  await recomputeProgressFromSubtasks(db, taskId);

  // Moving into done cancels reminders; moving out reschedules.
  if (isDone) {
    await cancelTaskReminders(db, taskId);
  } else {
    await rescheduleTaskReminders(db, taskId);
  }

  return updated;
}

async function recomputeProgressFromSubtasks(db: DB, taskId: string) {
  const subs = await db.query.subtasks.findMany({ where: (s, { eq: e }) => e(s.taskId, taskId) });
  if (subs.length === 0) return;
  const done = subs.filter((s) => s.isDone).length;
  const pct = Math.round((done / subs.length) * 100);
  await db.update(tasks).set({ progress: pct }).where(eq(tasks.id, taskId));
}

/* =====================================================================
 * Schedule update — PRD §8.3 (Gantt drag/resize)
 * ===================================================================== */

export async function updateTaskSchedule(
  db: DB,
  userId: string,
  taskId: string,
  input: { startDate?: string | null; dueDate?: string | null; dueTime?: string | null }
) {
  const task = await getOwnedTask(db, taskId, userId);

  const startDate = input.startDate ?? task.startDate;
  const dueDate = input.dueDate ?? task.dueDate;

  if (startDate && dueDate && startDate > dueDate) {
    throw new ApiError("BAD_REQUEST", "Start date must be before or equal to due date");
  }

  const [updated] = await db
    .update(tasks)
    .set({
      startDate: input.startDate !== undefined ? input.startDate : task.startDate,
      dueDate: input.dueDate !== undefined ? input.dueDate : task.dueDate,
      dueTime: input.dueTime !== undefined ? input.dueTime : task.dueTime,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId))
    .returning();

  await rescheduleTaskReminders(db, taskId);
  return updated;
}

/** Update reminder toggles/lead time (PRD F-4.3). */
export async function updateTaskReminders(
  db: DB,
  userId: string,
  taskId: string,
  input: { remindOnStart?: boolean; leadMinutes?: number | null; muted?: boolean }
) {
  const task = await getOwnedTask(db, taskId, userId);
  const [updated] = await db
    .update(tasks)
    .set({
      remindOnStart: input.remindOnStart !== undefined ? input.remindOnStart : task.remindOnStart,
      remindLeadMinutes: input.leadMinutes !== undefined ? input.leadMinutes : task.remindLeadMinutes,
      remindersMuted: input.muted !== undefined ? input.muted : task.remindersMuted,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId))
    .returning();

  await rescheduleTaskReminders(db, taskId);
  return updated;
}
