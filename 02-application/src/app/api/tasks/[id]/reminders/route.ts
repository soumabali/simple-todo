import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse } from "@/lib/session";
import { updateTaskReminders } from "@/lib/domain";
import { ApiError } from "@/lib/api-error";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/tasks/:id/reminders — { remindOnStart, leadMinutes, muted } (PRD F-4.3). */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    const body = await req.json();

    // A negative lead would schedule the reminder *after* the deadline.
    if (body.leadMinutes !== undefined && body.leadMinutes !== null) {
      const lead = Number(body.leadMinutes);
      if (!Number.isInteger(lead) || lead < 0) {
        throw new ApiError("BAD_REQUEST", "leadMinutes must be a non-negative whole number");
      }
    }

    const task = await updateTaskReminders(db, session.user.id, id, {
      remindOnStart: body.remindOnStart,
      // Pass through untouched: `undefined` means "leave as is", explicit
      // `null` means "clear the override". Coercing with `?? null` here would
      // silently wipe a per-task lead time on every unrelated toggle.
      leadMinutes: body.leadMinutes,
      muted: body.muted,
    });

    return NextResponse.json({ task });
  } catch (e) {
    return errorResponse(e);
  }
}
