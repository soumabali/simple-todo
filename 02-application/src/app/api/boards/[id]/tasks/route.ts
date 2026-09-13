import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse } from "@/lib/session";
import { createTask, getOwnedBoard } from "@/lib/domain";

type Params = { params: Promise<{ id: string }> };

/** POST /api/boards/:id/tasks — create a task (PRD F-4.1). */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    await getOwnedBoard(db, id, session.user.id);

    const body = await req.json();
    const task = await createTask(db, session.user.id, { ...body, boardId: id });
    return NextResponse.json({ task }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
