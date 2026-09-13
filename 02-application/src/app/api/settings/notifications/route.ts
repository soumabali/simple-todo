import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse } from "@/lib/session";
import { notificationSettings } from "@/db/schema";

/** GET /api/settings/notifications — the user's notification settings. */
export async function GET() {
  try {
    const session = await requireUser();
    const db = getDb();
    const s = await db.query.notificationSettings.findFirst({
      where: (n, { eq: e }) => e(n.userId, session.user.id),
    });
    return NextResponse.json({ settings: s ?? { userId: session.user.id } });
  } catch (e) {
    return errorResponse(e);
  }
}

/** PATCH /api/settings/notifications — update settings. */
export async function PATCH(req: NextRequest) {
  try {
    const session = await requireUser();
    const db = getDb();
    const body = await req.json();

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.pushEnabled !== undefined) patch.pushEnabled = Boolean(body.pushEnabled);
    if (body.defaultTime !== undefined) patch.defaultTime = String(body.defaultTime);
    if (body.leadMinutesStart !== undefined) patch.leadMinutesStart = Number(body.leadMinutesStart);
    if (body.leadMinutesDue !== undefined) patch.leadMinutesDue = Number(body.leadMinutesDue);
    if (body.notifyDueToday !== undefined) patch.notifyDueToday = Boolean(body.notifyDueToday);
    if (body.notifyOverdue !== undefined) patch.notifyOverdue = Boolean(body.notifyOverdue);
    if (body.quietStart !== undefined) patch.quietStart = String(body.quietStart);
    if (body.quietEnd !== undefined) patch.quietEnd = String(body.quietEnd);

    const [settings] = await db
      .insert(notificationSettings)
      .values({ userId: session.user.id, ...patch })
      .onConflictDoUpdate({
        target: notificationSettings.userId,
        set: patch,
      })
      .returning();

    return NextResponse.json({ settings });
  } catch (e) {
    return errorResponse(e);
  }
}
