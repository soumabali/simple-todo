import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse } from "@/lib/session";
import { getOwnedBoard } from "@/lib/domain";
import { boards } from "@/db/schema";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

/** GET /api/boards/:id — full payload for initial render (board + statuses + tasks + labels). */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    const userId = session.user.id;

    const board = await getOwnedBoard(db, id, userId);

    const [statusList, taskList, labelList] = await Promise.all([
      db.query.statuses.findMany({
        where: (s, { eq: e }) => e(s.boardId, id),
        orderBy: (s, { asc: a }) => a(s.position),
      }),
      db.query.tasks.findMany({
        where: (t, { eq: e }) => e(t.boardId, id),
        orderBy: (t, { asc: a }) => a(t.position),
      }),
      db.query.labels.findMany({
        where: (l, { eq: e }) => e(l.boardId, id),
        orderBy: (l, { asc: a }) => a(l.name),
      }),
    ]);

    const [subtaskList, taskLabelList] = await Promise.all([
      db.query.subtasks.findMany({
        where: (s, { inArray }) => inArray(s.taskId, taskList.map((t) => t.id)),
        orderBy: (s, { asc: a }) => a(s.position),
      }),
      db.query.taskLabels.findMany({
        where: (tl, { inArray }) => inArray(tl.taskId, taskList.map((t) => t.id)),
      }),
    ]);

    return NextResponse.json({
      board,
      statuses: statusList,
      tasks: taskList,
      labels: labelList,
      subtasks: subtaskList,
      taskLabels: taskLabelList,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** PATCH /api/boards/:id */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    await getOwnedBoard(db, id, session.user.id);

    const body = await req.json();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = String(body.name).slice(0, 60);
    if (body.description !== undefined) patch.description = body.description;
    if (body.color !== undefined) patch.color = body.color;
    if (body.isArchived !== undefined) patch.isArchived = Boolean(body.isArchived);
    if (body.position !== undefined) patch.position = String(body.position);

    const [updated] = await db.update(boards).set(patch).where(eq(boards.id, id)).returning();
    return NextResponse.json({ board: updated });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/boards/:id — cascades to everything inside (PRD F-2.3). */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    await getOwnedBoard(db, id, session.user.id);

    // Confirmation by retyping name is enforced in the UI; here we just cascade.
    await db.delete(boards).where(eq(boards.id, id));
    return NextResponse.json({ deleted: id });
  } catch (e) {
    return errorResponse(e);
  }
}
