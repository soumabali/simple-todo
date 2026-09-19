import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse, ApiError } from "@/lib/session";
import { pushSubscriptions } from "@/db/schema";
import { eq, and, count } from "drizzle-orm";

/** Unpadded base64url (the encoding used for Web Push p256dh/auth keys). */
function isBase64Url(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

/** POST /api/push/subscribe — store a subscription (max 10 devices). */
export async function POST(req: NextRequest) {
  try {
    const session = await requireUser();
    const db = getDb();
    const body = await req.json();

    const endpoint = String(body.endpoint ?? "");
    const p256dh = String(body.p256dh ?? "");
    const auth = String(body.auth ?? "");
    if (!endpoint || !p256dh || !auth) {
      throw new ApiError("BAD_REQUEST", "Invalid subscription");
    }

    // p256dh and auth are unpadded base64url strings (per the Web Push spec).
    // Reject garbage early so the reminder worker never tries to sign/encrypt
    // against a malformed key (it would fail every delivery).
    if (!isBase64Url(p256dh) || !isBase64Url(auth)) {
      throw new ApiError("BAD_REQUEST", "Invalid subscription keys");
    }

    // Validate the endpoint belongs to a known push service (PRD §11).
    const allowed = [
      "https://fcm.googleapis.com",
      "https://updates.push.services.mozilla.com",
      "https://web.push.apple.com",
      "https://android.googleapis.com",
    ];
    if (!allowed.some((d) => endpoint.startsWith(d))) {
      throw new ApiError("BAD_REQUEST", "Push endpoint is not a known push service");
    }

    const [row] = await db
      .select({ value: count() })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, session.user.id));
    const current = row?.value ?? 0;
    if (current >= 10) throw new ApiError("BAD_REQUEST", "Maximum 10 devices per user");

    const [sub] = await db
      .insert(pushSubscriptions)
      .values({
        userId: session.user.id,
        endpoint,
        p256dh,
        auth,
        deviceLabel: body.deviceLabel ?? null,
        isStandalone: Boolean(body.isStandalone),
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          p256dh,
          auth,
          deviceLabel: body.deviceLabel ?? null,
          isStandalone: Boolean(body.isStandalone),
        },
      })
      .returning();

    return NextResponse.json({ subscription: sub }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/push/subscribe — { endpoint } (forget device). */
export async function DELETE(req: NextRequest) {
  try {
    const session = await requireUser();
    const db = getDb();
    const body = await req.json();
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, session.user.id), eq(pushSubscriptions.endpoint, String(body.endpoint ?? ""))));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** GET /api/push/subscribe — list registered devices (for settings page). */
export async function GET() {
  try {
    const session = await requireUser();
    const db = getDb();
    const list = await db.query.pushSubscriptions.findMany({
      where: (p, { eq: e }) => e(p.userId, session.user.id),
      orderBy: (p, { desc: d }) => d(p.createdAt),
    });
    return NextResponse.json({ subscriptions: list });
  } catch (e) {
    return errorResponse(e);
  }
}
