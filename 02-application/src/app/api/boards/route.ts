import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse } from "@/lib/session";
import { createBoard } from "@/lib/domain";

export async function GET() {
  try {
    const session = await requireUser();
    const db = getDb();
    const userId = session.user.id;

    const list = await db.query.boards.findMany({
      where: (b, { eq: e }) => e(b.userId, userId),
      orderBy: (b, { asc: a }) => a(b.position),
    });

    // Enrich with task counts: total, overdue, due this week.
    const enriched = await Promise.all(
      list.map(async (board) => {
        const boardTasks = await db.query.tasks.findMany({
          where: (t, { eq: e }) => e(t.boardId, board.id),
          columns: { dueDate: true, completedAt: true },
        });
        const now = new Date();
        const weekEnd = new Date(now);
        weekEnd.setDate(now.getDate() + 7);
        const todayStr = now.toISOString().slice(0, 10);
        const weekEndStr = weekEnd.toISOString().slice(0, 10);

        const taskCount = boardTasks.length;
        const overdue = boardTasks.filter(
          (t) => !t.completedAt && t.dueDate && t.dueDate < todayStr
        ).length;
        const dueThisWeek = boardTasks.filter(
          (t) =>
            !t.completedAt && t.dueDate && t.dueDate >= todayStr && t.dueDate <= weekEndStr
        ).length;

        return { ...board, taskCount, overdue, dueThisWeek };
      })
    );

    return NextResponse.json({ boards: enriched });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireUser();
    const db = getDb();
    const body = await req.json();
    const board = await createBoard(db, session.user.id, body);
    return NextResponse.json({ board }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
