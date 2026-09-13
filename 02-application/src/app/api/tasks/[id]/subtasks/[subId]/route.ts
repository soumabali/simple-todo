import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse } from "@/lib/session";
import { getOwnedTask } from "@/lib/domain";
import { subtasks, tasks } from "@/db/schema";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string; subId: string }> };

/** PATCH /api/tasks/:id/subtasks/:subId — toggle done / rename. */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id, subId } = await params;
    const session = await requireUser();
    const db = getDb();
    await getOwnedTask(db, id, session.user.id);

    const body = await req.json();
    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = String(body.title);
    if (body.isDone !== undefined) patch.isDone = Boolean(body.isDone);
    if (body.position !== undefined) patch.position = String(body.position);

    const [updated] = await db.update(subtasks).set(patch).where(eq(subtasks.id, subId)).returning();

    // Recompute task progress from subtask ratio.
    const subs = await db.query.subtasks.findMany({ where: (s, { eq: e }) => e(s.taskId, id) });
    if (subs.length > 0) {
      const done = subs.filter((s) => s.isDone).length;
      const pct = Math.round((done / subs.length) * 100);
      await db.update(tasks).set({ progress: pct }).where(eq(tasks.id, id));
    }

    return NextResponse.json({ subtask: updated });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/tasks/:id/subtasks/:subId */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id, subId } = await params;
    const session = await requireUser();
    const db = getDb();
    await getOwnedTask(db, id, session.user.id);

    await db.delete(subtasks).where(eq(subtasks.id, subId));

    // Recompute task progress.
    const subs = await db.query.subtasks.findMany({ where: (s, { eq: e }) => e(s.taskId, id) });
    if (subs.length > 0) {
      const done = subs.filter((s) => s.isDone).length;
      const pct = Math.round((done / subs.length) * 100);
      await db.update(tasks).set({ progress: pct }).where(eq(tasks.id, id));
    }

    return NextResponse.json({ deleted: subId });
  } catch (e) {
    return errorResponse(e);
  }
}
