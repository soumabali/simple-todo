import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse, ApiError } from "@/lib/session";
import { getOwnedStatus } from "@/lib/domain";
import { statuses, tasks } from "@/db/schema";
import { eq, and, count } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/statuses/:id — update name/color/wip/is_done. */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    const st = await getOwnedStatus(db, id, session.user.id);

    const body = await req.json();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = String(body.name);
    if (body.color !== undefined) patch.color = body.color;
    if (body.wipLimit !== undefined) patch.wipLimit = body.wipLimit;
    if (body.isDone !== undefined) {
      // Only one "done" column per board (PRD F-3.2).
      if (body.isDone) {
        await db
          .update(statuses)
          .set({ isDone: false })
          .where(and(eq(statuses.boardId, st.boardId), eq(statuses.isDone, true)));
      }
      patch.isDone = Boolean(body.isDone);
    }

    const [updated] = await db.update(statuses).set(patch).where(eq(statuses.id, id)).returning();
    return NextResponse.json({ status: updated });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/statuses/:id?moveTo=<statusId> — reject if it holds tasks (PRD F-3.3). */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    const st = await getOwnedStatus(db, id, session.user.id);

    const moveTo = req.nextUrl.searchParams.get("moveTo");

    const [heldRow] = await db.select({ value: count() }).from(tasks).where(eq(tasks.statusId, id));
    const held = heldRow?.value ?? 0;

    if (held > 0) {
      if (!moveTo) {
        throw new ApiError("BAD_REQUEST", `This column holds ${held} tasks`, 409);
      }
      // Verify moveTo belongs to the same board.
      const target = await getOwnedStatus(db, moveTo, session.user.id);
      if (target.boardId !== st.boardId) {
        throw new ApiError("BAD_REQUEST", "Target column does not belong to this board");
      }
      // Move tasks, then delete.
      await db.update(tasks).set({ statusId: moveTo }).where(eq(tasks.statusId, id));
    }

    await db.delete(statuses).where(eq(statuses.id, id));
    return NextResponse.json({ deleted: id });
  } catch (e) {
    return errorResponse(e);
  }
}
