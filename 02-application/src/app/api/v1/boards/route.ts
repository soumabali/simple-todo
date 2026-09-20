import { NextResponse } from "next/server";
import { withApi, preflight, todayIn } from "@/lib/api-v1";

/**
 * GET /api/v1/boards — every board owned by the key's user, with statuses and
 * task counts. This is the natural entry point for an integration: it returns
 * the board/status ids needed by the other endpoints.
 */
export const GET = withApi(async ({ db, principal }) => {
  const user = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, principal.userId),
    columns: { timezone: true },
  });
  const today = todayIn(user?.timezone ?? "Asia/Makassar");

  const boards = await db.query.boards.findMany({
    where: (b, { eq, and }) => and(eq(b.userId, principal.userId), eq(b.isArchived, false)),
    orderBy: (b, { asc }) => asc(b.position),
  });

  const enriched = await Promise.all(
    boards.map(async (board) => {
      const [boardTasks, boardStatuses] = await Promise.all([
        db.query.tasks.findMany({
          where: (t, { eq }) => eq(t.boardId, board.id),
          columns: { id: true, dueDate: true, completedAt: true },
        }),
        db.query.statuses.findMany({
          where: (s, { eq }) => eq(s.boardId, board.id),
          orderBy: (s, { asc }) => asc(s.position),
          columns: { id: true, name: true, color: true, isDone: true, wipLimit: true },
        }),
      ]);

      const open = boardTasks.filter((t) => !t.completedAt);
      const overdue = open.filter((t) => t.dueDate && t.dueDate < today).length;

      return {
        id: board.id,
        name: board.name,
        description: board.description,
        color: board.color,
        taskCount: boardTasks.length,
        openCount: open.length,
        overdueCount: overdue,
        statuses: boardStatuses,
      };
    })
  );

  return NextResponse.json({ boards: enriched, today });
});

export const OPTIONS = () => preflight();
