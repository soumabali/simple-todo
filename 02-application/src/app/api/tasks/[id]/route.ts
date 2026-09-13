import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse, ApiError } from "@/lib/session";
import { getOwnedTask } from "@/lib/domain";
import { tasks } from "@/db/schema";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/tasks/:id — edit task fields (autosave, PRD F-4.4). */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    await getOwnedTask(db, id, session.user.id);

    const body = await req.json();
    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) throw new ApiError("BAD_REQUEST", "Title is required");
      patch.title = title;
    }
    if (body.description !== undefined) patch.description = body.description;
    if (body.priority !== undefined) {
      const p = Number(body.priority);
      if (p < 1 || p > 4) throw new ApiError("BAD_REQUEST", "Priority must be 1–4");
      patch.priority = p;
    }
    if (body.progress !== undefined) {
      const p = Number(body.progress);
      if (p < 0 || p > 100) throw new ApiError("BAD_REQUEST", "Progress must be 0–100");
      patch.progress = p;
    }
    if (body.completedAt !== undefined) patch.completedAt = body.completedAt;

    const [updated] = await db.update(tasks).set(patch).where(eq(tasks.id, id)).returning();
    return NextResponse.json({ task: updated });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/tasks/:id */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    await getOwnedTask(db, id, session.user.id);
    await db.delete(tasks).where(eq(tasks.id, id));
    return NextResponse.json({ deleted: id });
  } catch (e) {
    return errorResponse(e);
  }
}
