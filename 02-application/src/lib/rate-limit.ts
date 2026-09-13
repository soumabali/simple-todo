import { and, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { loginAttempts } from "@/db/schema";

/**
 * Login rate limiting (PRD §F-1.1).
 *
 *  - 5 failed attempts per email within 15 minutes
 *  - 20 failed attempts per IP within 15 minutes
 *
 * Durable across Worker isolates because counters are stored in Postgres
 * (better-auth's built-in limiter is in-memory and unsuitable on workerd).
 */

const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_EMAIL = 5;
export const MAX_FAILURES_PER_IP = 20;

type DB = ReturnType<typeof getDb>;

function windowStart(): Date {
  return new Date(Date.now() - WINDOW_MS);
}

/** True if the email or IP has exceeded the failure threshold. */
export async function isLoginRateLimited(db: DB, email: string, ip: string | null): Promise<boolean> {
  const since = windowStart();

  const [emailRow] = await db
    .select({ value: sql<number>`count(*)` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since)));

  if (Number(emailRow?.value ?? 0) >= MAX_FAILURES_PER_EMAIL) return true;

  if (ip) {
    const [ipRow] = await db
      .select({ value: sql<number>`count(*)` })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since)));
    if (Number(ipRow?.value ?? 0) >= MAX_FAILURES_PER_IP) return true;
  }

  return false;
}

export async function recordLoginAttempt(db: DB, email: string, ip: string | null, success: boolean): Promise<void> {
  await db.insert(loginAttempts).values({
    email: email.toLowerCase(),
    ip: ip ?? null,
    success,
  });
}

/** Resolve the client IP from Cloudflare/Next headers. */
export function clientIp(headers: Headers): string | null {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}
