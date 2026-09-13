import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse } from "@/lib/session";
import { getOwnedBoard } from "@/lib/domain";
import { tasks } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

/** GET /api/boards/:id/gantt?from=&to= — timeline data (PRD §9). */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    await getOwnedBoard(db, id, session.user.id);

    const from = req.nextUrl.searchParams.get("from");
    const to = req.nextUrl.searchParams.get("to");

    const conditions = [eq(tasks.boardId, id)];
    if (from) conditions.push(sql`${tasks.dueDate} >= ${from} OR ${tasks.dueDate} IS NULL`);
    if (to) conditions.push(sql`${tasks.startDate} <= ${to} OR ${tasks.startDate} IS NULL`);

    const list = await db.query.tasks.findMany({
      where: () => and(...conditions),
      orderBy: (t, { asc: a }) => a(t.startDate),
    });

    return NextResponse.json({ tasks: list });
  } catch (e) {
    return errorResponse(e);
  }
}
