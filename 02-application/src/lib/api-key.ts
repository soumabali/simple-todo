import { eq, lt, sql } from "drizzle-orm";
import type { getDb } from "@/db";
import { apiKeys, apiRateLimits } from "@/db/schema";
import { ApiError } from "@/lib/api-error";

/**
 * Public API keys (`/api/v1/*`).
 *
 * Design notes:
 *  - The plaintext key is shown ONCE at creation. Only `sha256(plaintext)` is
 *    persisted, so a database leak does not expose usable keys.
 *  - `prefix` ("fbk_1a2b3c4d") is stored in the clear so the UI can label keys.
 *  - Every /api/v1 handler resolves the key to exactly one user and scopes all
 *    queries to that user; a key can never read another user's data.
 *  - Rate limiting is stored in Postgres because Worker isolates do not share
 *    memory (same reasoning as lib/rate-limit.ts).
 */

export const API_KEY_PREFIX = "fbk_";
export const API_KEY_BYTES = 32; // 256-bit
export const RATE_LIMIT_PER_MINUTE = 120;
export const RATE_LIMIT_WINDOW_MS = 60_000;

export type ApiKeyScope = "read" | "write";

type DB = ReturnType<typeof getDb>;

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** SHA-256 of the plaintext key, lowercase hex. Web Crypto runs on Node and workerd alike. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

export type GeneratedKey = { plaintext: string; prefix: string; keyHash: string };

/** Mint a new key. Format: `fbk_` + 64 hex chars. */
export async function generateApiKey(): Promise<GeneratedKey> {
  const bytes = new Uint8Array(API_KEY_BYTES);
  crypto.getRandomValues(bytes);
  const body = toHex(bytes);
  const plaintext = `${API_KEY_PREFIX}${body}`;
  return {
    plaintext,
    prefix: `${API_KEY_PREFIX}${body.slice(0, 8)}`,
    keyHash: await sha256Hex(plaintext),
  };
}

/** Cheap shape check so garbage never reaches the database. */
export function looksLikeApiKey(value: string): boolean {
  return new RegExp(`^${API_KEY_PREFIX}[0-9a-f]{${API_KEY_BYTES * 2}}$`).test(value);
}

/** Pull the key out of `Authorization: Bearer <key>` or `x-api-key: <key>`. */
export function extractApiKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  const header = req.headers.get("x-api-key");
  return header ? header.trim() : null;
}

export type ApiPrincipal = {
  keyId: string;
  userId: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
};

/**
 * Resolve a presented key to its owner.
 * Throws 401 (invalid/revoked/expired) or 403 (owner banned) — the same 401 for
 * every failure mode so the endpoint never confirms whether a key exists.
 */
export async function verifyApiKey(db: DB, presented: string): Promise<ApiPrincipal> {
  const invalid = () => new ApiError("UNAUTHORIZED", "Invalid or revoked API key", 401);

  if (!looksLikeApiKey(presented)) throw invalid();

  const hash = await sha256Hex(presented);
  const row = await db.query.apiKeys.findFirst({
    where: (k, { eq: e }) => e(k.keyHash, hash),
  });
  if (!row || row.revokedAt) throw invalid();
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) throw invalid();

  const owner = await db.query.user.findFirst({
    where: (u, { eq: e }) => e(u.id, row.userId),
  });
  if (!owner) throw invalid();
  if (owner.banned) throw new ApiError("FORBIDDEN", "Account is deactivated", 403);

  // Throttle the "last used" write to at most once a minute per key.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id))
      .catch(() => {});
  }

  return {
    keyId: row.id,
    userId: row.userId,
    name: row.name,
    prefix: row.prefix,
    scopes: (row.scopes ?? ["read", "write"]) as ApiKeyScope[],
  };
}

export type RateLimitState = {
  limit: number;
  remaining: number;
  resetAt: Date;
};

/** Increment the per-key counter for the current minute; throw 429 when exceeded. */
export async function enforceRateLimit(db: DB, keyId: string): Promise<RateLimitState> {
  const windowStart = new Date(Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS);

  const [row] = await db
    .insert(apiRateLimits)
    .values({ keyId, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [apiRateLimits.keyId, apiRateLimits.windowStart],
      set: { count: sql`${apiRateLimits.count} + 1` },
    })
    .returning();

  const count = Number(row?.count ?? 0);

  // Opportunistic GC: on the first hit of a fresh window, drop stale windows.
  if (count === 1) {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    await db.delete(apiRateLimits).where(lt(apiRateLimits.windowStart, cutoff)).catch(() => {});
  }

  const state: RateLimitState = {
    limit: RATE_LIMIT_PER_MINUTE,
    remaining: Math.max(0, RATE_LIMIT_PER_MINUTE - count),
    resetAt: new Date(windowStart.getTime() + RATE_LIMIT_WINDOW_MS),
  };

  if (count > RATE_LIMIT_PER_MINUTE) {
    throw new ApiError(
      "RATE_LIMITED",
      `Rate limit exceeded (${RATE_LIMIT_PER_MINUTE} requests/minute)`,
      429,
      { "Retry-After": String(Math.max(1, Math.ceil((state.resetAt.getTime() - Date.now()) / 1000))) }
    );
  }

  return state;
}

/** All keys of a user, newest first (passwords/hashes never leave the server). */
export async function listApiKeys(db: DB, userId: string) {
  return db.query.apiKeys.findMany({
    where: (k, { eq: e }) => e(k.userId, userId),
    orderBy: (k, { desc: d }) => d(k.createdAt),
  });
}

export function isKeyActive(key: { revokedAt: Date | null; expiresAt: Date | null }): boolean {
  if (key.revokedAt) return false;
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) return false;
  return true;
}

export function parseScopes(input: unknown): ApiKeyScope[] {
  if (!Array.isArray(input) || input.length === 0) return ["read", "write"];
  const valid = input.filter((s): s is ApiKeyScope => s === "read" || s === "write");
  return valid.length ? [...new Set(valid)] : ["read", "write"];
}
