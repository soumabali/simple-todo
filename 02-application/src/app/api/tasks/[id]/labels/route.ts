import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse, ApiError } from "@/lib/session";
import { getOwnedTask } from "@/lib/domain";
import { taskLabels } from "@/db/schema";
import { and, eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/tasks/:id/labels — labels attached to a task.
 * POST /api/tasks/:id/labels — attach a label { labelId }.
 * DELETE /api/tasks/:id/labels — detach a label { labelId }.
 *
 * The label must belong to the same board as the task (F-3.5). Idempotent:
 * attaching twice or detaching a non-attached label is a no-op.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    await getOwnedTask(db, id, session.user.id);

    const rows = await db.query.taskLabels.findMany({
      where: (tl, { eq: e }) => e(tl.taskId, id),
    });
    return NextResponse.json({ labelIds: rows.map((r) => r.labelId) });
  } catch (e) {
    return errorResponse(e);
  }
}

async function validateLabelBelongsToBoard(db: ReturnType<typeof getDb>, taskId: string, labelId: string) {
  const task = await db.query.tasks.findFirst({ where: (t, { eq: e }) => e(t.id, taskId) });
  const label = await db.query.labels.findFirst({ where: (l, { eq: e }) => e(l.id, labelId) });
  if (!task || !label || label.boardId !== task.boardId) {
    throw new ApiError("BAD_REQUEST", "Label does not belong to this task's board");
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    await getOwnedTask(db, id, session.user.id);

    const body = await req.json();
    const labelId = String(body.labelId ?? "").trim();
    if (!labelId) throw new ApiError("BAD_REQUEST", "labelId is required");

    await validateLabelBelongsToBoard(db, id, labelId);

    // Idempotent attach.
    await db.insert(taskLabels).values({ taskId: id, labelId }).onConflictDoNothing();
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    await getOwnedTask(db, id, session.user.id);

    const body = await req.json().catch(() => ({}));
    const labelId = String(body?.labelId ?? "").trim();
    if (!labelId) throw new ApiError("BAD_REQUEST", "labelId is required");

    await db.delete(taskLabels).where(and(eq(taskLabels.taskId, id), eq(taskLabels.labelId, labelId)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
