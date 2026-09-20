import { NextResponse } from "next/server";
import { and, inArray, isNull, sql } from "drizzle-orm";
import { tasks } from "@/db/schema";
import { withApi, preflight, serializeTask, todayIn, parseLimit, daysUntil } from "@/lib/api-v1";

/**
 * GET /api/v1/todos/expiring — what needs attention now.
 *
 * Returns three buckets so an integration (or an LLM agent) can act on them
 * directly without client-side date maths:
 *   overdue  — past due, still open
 *   today    — due today, still open
 *   soon     — due within `within` days (default 7), still open
 *
 * Query params: within=<days> (default 7, max 365), boardId=<uuid>, limit=<n>
 */
export const GET = withApi(async ({ db, principal }, req) => {
  const url = new URL(req.url);
  const p = url.searchParams;
  const within = Math.min(Math.max(Number(p.get("within") ?? 7) || 7, 1), 365);
  const boardId = p.get("boardId");
  const limit = parseLimit(p.get("limit"), 100);

  const user = await db.query.user.findFirst({
    where: (u, { eq: e }) => e(u.id, principal.userId),
    columns: { timezone: true },
  });
  const timezone = user?.timezone ?? "Asia/Makassar";
  const today = todayIn(timezone);

  const ownedBoards = await db.query.boards.findMany({
    where: (b, { eq: e }) => e(b.userId, principal.userId),
    columns: { id: true, name: true },
  });
  const boardName = new Map(ownedBoards.map((b) => [b.id, b.name]));
  const ownedBoardIds = boardId ? [boardId] : ownedBoards.map((b) => b.id);

  if (!ownedBoardIds.length || (boardId && !boardName.has(boardId))) {
    return NextResponse.json({
      overdue: [],
      today: [],
      soon: [],
      meta: { today, timezone, within, counts: { overdue: 0, today: 0, soon: 0 } },
    });
  }

  const until = addDays(today, within);

  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        inArray(tasks.boardId, ownedBoardIds),
        isNull(tasks.completedAt),
        sql`${tasks.dueDate} IS NOT NULL`,
        sql`${tasks.dueDate} <= ${until}`
      )
    )
    .orderBy(sql`${tasks.dueDate} ASC`, sql`${tasks.position} ASC`)
    .limit(limit);

  const enriched = rows.map((task) => ({
    ...serializeTask(task, today),
    boardName: boardName.get(task.boardId) ?? null,
  }));

  const overdue = enriched.filter((t) => (daysUntil(t.dueDate, today) ?? 0) < 0);
  const dueToday = enriched.filter((t) => t.dueDate === today);
  const soon = enriched.filter((t) => {
    const d = daysUntil(t.dueDate, today);
    return d !== null && d > 0;
  });

  return NextResponse.json({
    overdue,
    today: dueToday,
    soon,
    meta: {
      today,
      timezone,
      within,
      counts: { overdue: overdue.length, today: dueToday.length, soon: soon.length },
    },
  });
});

export const OPTIONS = () => preflight();

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
