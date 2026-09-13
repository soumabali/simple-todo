import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { getDb } from "@/db";
import { isLoginRateLimited, recordLoginAttempt, clientIp } from "@/lib/rate-limit";

/**
 * Auth API catch-all — mounted at /api/auth/*.
 * Wraps the better-auth handler to add per-email / per-IP login rate limiting
 * (PRD §F-1.1): 5 failures/email/15min and 20 failures/IP/15min.
 */

const base = toNextJsHandler(auth.handler);

async function wrap(method: keyof typeof base, req: NextRequest) {
  const handler = base[method] as (req: NextRequest) => Promise<Response>;
  if (typeof handler !== "function") return handler;

  const url = new URL(req.url);
  const isSignIn = url.pathname.endsWith("/sign-in/email");

  if (!isSignIn) return handler(req);

  // Clone body to read email without consuming the request.
  let email = "";
  try {
    const body = await req.clone().json();
    email = String(body?.email ?? "").toLowerCase();
  } catch {
    // Not JSON or empty — let better-auth's own validation reject it.
    return handler(req);
  }

  const ip = clientIp(req.headers);

  if (email && (await isLoginRateLimited(getDb(), email, ip))) {
    // Generic message, but signal the specific deactivation case is NOT the
    // issue — match the PRD's uniform failure response.
    return Response.json(
      { error: { code: "RATE_LIMITED", message: "Too many attempts. Try again in 15 minutes." } },
      { status: 429 }
    );
  }

  const res = await handler(req);

  // Record the outcome. A 200 means success; otherwise failure (401/400).
  const success = res.status >= 200 && res.status < 300;
  if (email) {
    await recordLoginAttempt(getDb(), email, ip, success).catch(() => {});
  }

  return res;
}

export async function GET(req: NextRequest) {
  return wrap("GET", req);
}
export async function POST(req: NextRequest) {
  return wrap("POST", req);
}
export async function PATCH(req: NextRequest) {
  return wrap("PATCH", req);
}
export async function PUT(req: NextRequest) {
  return wrap("PUT", req);
}
export async function DELETE(req: NextRequest) {
  return wrap("DELETE", req);
}
