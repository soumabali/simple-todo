import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse } from "@/lib/session";
import { updateTaskReminders } from "@/lib/domain";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/tasks/:id/reminders — { remindOnStart, leadMinutes, muted } (PRD F-4.3). */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    const body = await req.json();

    const task = await updateTaskReminders(db, session.user.id, id, {
      remindOnStart: body.remindOnStart,
      leadMinutes: body.leadMinutes ?? null,
      muted: body.muted,
    });

    return NextResponse.json({ task });
  } catch (e) {
    return errorResponse(e);
  }
}
