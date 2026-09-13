import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse, ApiError } from "@/lib/session";
import { sendPush } from "@/lib/push";

/** POST /api/push/test — send a test notification to a device (PRD F-6.2). */
export async function POST(req: NextRequest) {
  try {
    const session = await requireUser();
    const db = getDb();
    const body = await req.json();
    const endpoint = String(body.endpoint ?? "");

    const sub = await db.query.pushSubscriptions.findFirst({
      where: (p, { eq: e, and: a }) =>
        a(e(p.userId, session.user.id), e(p.endpoint, endpoint)),
    });
    if (!sub) throw new ApiError("NOT_FOUND", "Device not found", 404);

    const status = await sendPush(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      { title: "Reminders are on 🎉", body: "FlowBoard will now remind you about your tasks." },
      "test-notification"
    );

    if (status >= 200 && status < 300) {
      return NextResponse.json({ ok: true, status });
    }
    return NextResponse.json({ ok: false, status }, { status: 502 });
  } catch (e) {
    return errorResponse(e);
  }
}
