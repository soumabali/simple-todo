import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse } from "@/lib/session";
import { updateTaskSchedule } from "@/lib/domain";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/tasks/:id/schedule — { startDate, dueDate, dueTime } (PRD §8.3). */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    const body = await req.json();

    const task = await updateTaskSchedule(db, session.user.id, id, {
      // `undefined` = leave unchanged, explicit `null` = clear. Passing `?? null`
      // would wipe the dates on a partial update that only carries dueTime.
      startDate: body.startDate,
      dueDate: body.dueDate,
      dueTime: body.dueTime,
    });

    return NextResponse.json({ task });
  } catch (e) {
    return errorResponse(e);
  }
}
