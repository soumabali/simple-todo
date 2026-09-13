import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse, ApiError } from "@/lib/session";
import { getOwnedTask } from "@/lib/domain";
import { subtasks } from "@/db/schema";

type Params = { params: Promise<{ id: string }> };

/** POST /api/tasks/:id/subtasks — add a checklist item. */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    await getOwnedTask(db, id, session.user.id);

    const body = await req.json();
    const title = String(body.title ?? "").trim();
    if (!title) throw new ApiError("BAD_REQUEST", "Title is required");

    const last = await db.query.subtasks.findFirst({
      where: (s, { eq: e }) => e(s.taskId, id),
      orderBy: (s, { desc: d }) => d(s.position),
    });
    const position = (last ? Number(last.position) : 1000) + 1000;

    const [sub] = await db
      .insert(subtasks)
      .values({ taskId: id, title, position: String(position) })
      .returning();

    return NextResponse.json({ subtask: sub }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
