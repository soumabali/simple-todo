import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse } from "@/lib/session";
import { notificationQueue } from "@/db/schema";
import { eq, and, lt, inArray, sql } from "drizzle-orm";

/** GET /api/notifications?cursor= — inbox history (status 'sent'), 30 days. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireUser();
    const db = getDb();
    const cursor = Number(req.nextUrl.searchParams.get("cursor") ?? "0");
    const limit = 50;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    // Cursor pagination: BIGSERIAL id is monotonic with insertion order, so
    // `id < cursor` pages backward through the inbox (newest first).
    const where = cursor > 0
      ? and(
          eq(notificationQueue.userId, session.user.id),
          eq(notificationQueue.status, "sent"),
          sql`${notificationQueue.sentAt} >= ${cutoff}`,
          lt(notificationQueue.id, cursor)
        )
      : and(
          eq(notificationQueue.userId, session.user.id),
          eq(notificationQueue.status, "sent"),
          sql`${notificationQueue.sentAt} >= ${cutoff}`
        );

    const list = await db
      .select()
      .from(notificationQueue)
      .where(where)
      .orderBy(sql`${notificationQueue.id} DESC`)
      .limit(limit + 1);

    const hasMore = list.length > limit;
    const rows = hasMore ? list.slice(0, limit) : list;

    // Join task titles (and board id, so the inbox can deep link into a board).
    const taskIds = [...new Set(rows.map((r) => r.taskId))];
    const taskMap = new Map<string, { title: string; boardId: string }>();
    if (taskIds.length) {
      const ts = await db.query.tasks.findMany({
        where: (t, { inArray: ia }) => ia(t.id, taskIds),
        columns: { id: true, title: true, boardId: true },
      });
      for (const t of ts) taskMap.set(t.id, { title: t.title, boardId: t.boardId });
    }

    const enriched = rows.map((r) => ({
      ...r,
      taskTitle: taskMap.get(r.taskId)?.title ?? "(deleted task)",
      boardId: taskMap.get(r.taskId)?.boardId ?? null,
    }));

    return NextResponse.json({
      notifications: enriched,
      nextCursor: hasMore ? rows[rows.length - 1].id : null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST /api/notifications/read — { ids } or { all: true }. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireUser();
    const db = getDb();
    const body = await req.json();

    if (body.all) {
      await db
        .update(notificationQueue)
        .set({ readAt: new Date() })
        .where(and(eq(notificationQueue.userId, session.user.id), eq(notificationQueue.status, "sent")));
    } else if (Array.isArray(body.ids) && body.ids.length) {
      await db
        .update(notificationQueue)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notificationQueue.userId, session.user.id),
            inArray(notificationQueue.id, body.ids)
          )
        );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
