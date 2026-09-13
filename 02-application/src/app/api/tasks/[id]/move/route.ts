import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse } from "@/lib/session";
import { moveTask } from "@/lib/domain";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/tasks/:id/move — { statusId, prevPosition, nextPosition } (PRD §8.2). */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    const body = await req.json();

    const task = await moveTask(db, session.user.id, id, {
      statusId: body.statusId,
      prevPosition: body.prevPosition ?? null,
      nextPosition: body.nextPosition ?? null,
    });

    return NextResponse.json({ task });
  } catch (e) {
    return errorResponse(e);
  }
}
