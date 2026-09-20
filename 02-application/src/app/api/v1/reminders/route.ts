import { NextResponse } from "next/server";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { notificationQueue } from "@/db/schema";
import { withApi, preflight, serializeTask, todayIn, parseLimit } from "@/lib/api-v1";

/**
 * GET /api/v1/reminders — the reminder agenda for the key's user.
 *
 * Two views:
 *   ?view=upcoming (default) — pending reminders scheduled from now until
 *                              `within` days (default 7), grouped by task.
 *   ?view=inbox              — reminders already delivered (`sent`), newest
 *                              first, with `unread` support.
 *   ?view=kinds              — every reminder kind configured for a task.
 *
 * Each item carries the reminder `kind` (start_soon | due_soon | due_today |
 * overdue) and the resolved `scheduledFor` timestamp, so a calling agent can
 * decide what to surface without recomputing any scheduling logic.
 */
export const GET = withApi(async ({ db, principal }, req) => {
  const url = new URL(req.url);
  const p = url.searchParams;
  const view = p.get("view") ?? "upcoming";
  const within = Math.min(Math.max(Number(p.get("within") ?? 7) || 7, 1), 365);
  const limit = parseLimit(p.get("limit"), 100);
  const unreadOnly = p.get("unread") === "true" || p.get("unread") === "1";

  const user = await db.query.user.findFirst({
    where: (u, { eq: e }) => e(u.id, principal.userId),
    columns: { timezone: true },
  });
  const timezone = user?.timezone ?? "Asia/Makassar";
  const today = todayIn(timezone);

  // `kinds` is a catalogue view: it explains how reminders are scheduled for
  // this user, so an integration can render labels/lead times without having to
  // know the scheduling rules. It never lists queue rows.
  if (view === "kinds") {
    const settings = await db.query.notificationSettings.findFirst({
      where: (s, { eq: e }) => e(s.userId, principal.userId),
    });

    const kinds = [
      {
        kind: "start_soon",
        label: "Starting soon",
        description: "Dikirim sebelum tanggal mulai task",
        enabled: true,
        leadMinutes: settings?.leadMinutesStart ?? 0,
      },
      {
        kind: "due_soon",
        label: "Due soon",
        description: "Dikirim sebelum tenggat waktu task",
        enabled: true,
        leadMinutes: settings?.leadMinutesDue ?? 1440,
      },
      {
        kind: "due_today",
        label: "Due today",
        description: "Dikirim pagi di hari tenggat waktu",
        enabled: settings?.notifyDueToday ?? true,
        leadMinutes: null,
      },
      {
        kind: "overdue",
        label: "Overdue",
        description: "Dikirim sekali setelah tenggat waktu terlewat",
        enabled: settings?.notifyOverdue ?? true,
        leadMinutes: null,
      },
    ];

    return NextResponse.json({
      kinds,
      settings: {
        pushEnabled: settings?.pushEnabled ?? true,
        // Postgres `time` columns come back as HH:MM:SS — trim to the HH:MM the
        // API documents.
        defaultTime: (settings?.defaultTime ?? "08:00").slice(0, 5),
        quietStart: (settings?.quietStart ?? "22:00").slice(0, 5),
        quietEnd: (settings?.quietEnd ?? "07:00").slice(0, 5),
      },
      meta: { count: kinds.length, today, timezone, view },
    });
  }

  const ownedBoards = await db.query.boards.findMany({
    where: (b, { eq: e }) => e(b.userId, principal.userId),
    columns: { id: true, name: true },
  });
  const boardName = new Map(ownedBoards.map((b) => [b.id, b.name]));

  if (!ownedBoards.length) {
    return NextResponse.json({ reminders: [], meta: { count: 0, today, timezone, view } });
  }

  const where =
    view === "inbox"
      ? and(
          eq(notificationQueue.userId, principal.userId),
          eq(notificationQueue.status, "sent"),
          unreadOnly ? sql`${notificationQueue.readAt} IS NULL` : sql`true`
        )
      : view === "kinds"
        ? and(eq(notificationQueue.userId, principal.userId))
        : and(
            eq(notificationQueue.userId, principal.userId),
            eq(notificationQueue.status, "pending"),
            gte(notificationQueue.scheduledFor, new Date()),
            lte(notificationQueue.scheduledFor, addDays(new Date(), within))
          );

  const rows = await db
    .select()
    .from(notificationQueue)
    .where(where)
    .orderBy(
      view === "inbox"
        ? sql`${notificationQueue.sentAt} DESC NULLS LAST`
        : sql`${notificationQueue.scheduledFor} ASC`
    )
    .limit(limit);

  if (!rows.length) {
    return NextResponse.json({ reminders: [], meta: { count: 0, today, timezone, view } });
  }

  const taskIds = [...new Set(rows.map((r) => r.taskId))];
  const taskList = await db.query.tasks.findMany({
    where: (t, { inArray: ia }) => ia(t.id, taskIds),
  });
  const taskMap = new Map(taskList.map((t) => [t.id, t]));

  const reminders = rows
    .filter((r) => taskMap.has(r.taskId)) // the task was deleted
    .map((r) => {
      const task = taskMap.get(r.taskId)!;
      return {
        id: Number(r.id),
        kind: r.kind,
        status: r.status,
        scheduledFor: r.scheduledFor.toISOString(),
        sentAt: r.sentAt ? r.sentAt.toISOString() : null,
        readAt: r.readAt ? r.readAt.toISOString() : null,
        read: Boolean(r.readAt),
        boardId: task.boardId,
        boardName: boardName.get(task.boardId) ?? null,
        todo: serializeTask(task, today),
      };
    });

  return NextResponse.json({
    reminders,
    meta: {
      count: reminders.length,
      today,
      timezone,
      view,
      within: view === "upcoming" ? within : null,
    },
  });
});

/**
 * POST /api/v1/reminders — acknowledge inbox items.
 * Body: { ids: number[] } or { all: true }
 */
export const POST = withApi(
  async ({ db, principal }, req) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.all === true) {
      await db
        .update(notificationQueue)
        .set({ readAt: new Date() })
        .where(
          and(eq(notificationQueue.userId, principal.userId), eq(notificationQueue.status, "sent"))
        );
    } else if (Array.isArray(body.ids) && body.ids.length) {
      const ids = body.ids.map((n) => Number(n)).filter((n) => Number.isFinite(n));
      if (!ids.length) return NextResponse.json({ updated: 0 });
      await db
        .update(notificationQueue)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notificationQueue.userId, principal.userId),
            inArray(notificationQueue.id, ids)
          )
        );
    }

    return NextResponse.json({ ok: true });
  },
  "write"
);

export const OPTIONS = () => preflight();

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
