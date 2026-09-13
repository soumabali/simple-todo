import { NextResponse } from "next/server";
import { getVapidKeys } from "@/lib/push";
import { errorResponse } from "@/lib/session";

/** GET /api/push/public-key — VAPID public key for client subscription. */
export async function GET() {
  try {
    const { publicKey } = getVapidKeys();
    return NextResponse.json({ publicKey });
  } catch (e) {
    return errorResponse(e);
  }
}
