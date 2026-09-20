import { getDb } from "@/db";
import { ApiError, errorResponse } from "@/lib/api-error";
import {
  enforceRateLimit,
  extractApiKey,
  verifyApiKey,
  type ApiPrincipal,
  type ApiKeyScope,
  type RateLimitState,
} from "@/lib/api-key";
import type { tasks } from "@/db/schema";

/**
 * Shared plumbing for the public REST API (`/api/v1/*`).
 *
 * Every /api/v1 handler authenticates with an API key instead of a session
 * cookie, then runs exactly the same ownership-scoped domain helpers as the
 * web UI. There is no path by which a key reaches another user's rows.
 */

export type V1Context = {
  db: ReturnType<typeof getDb>;
  principal: ApiPrincipal;
  rateLimit: RateLimitState;
};

/** Headers advertising the caller's current quota. */
export function rateLimitHeaders(state: RateLimitState): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(state.limit),
    "X-RateLimit-Remaining": String(state.remaining),
    "X-RateLimit-Reset": String(Math.floor(state.resetAt.getTime() / 1000)),
  };
}

/**
 * Authenticate a /api/v1 request.
 * @param requireScope "write" for mutations, "read" (default) for queries.
 */
export async function authenticate(req: Request, requireScope: ApiKeyScope = "read"): Promise<V1Context> {
  const presented = extractApiKey(req);
  if (!presented) {
    throw new ApiError(
      "UNAUTHORIZED",
      "Missing API key. Send it as an Authorization Bearer header, or as an x-api-key header.",
      401
    );
  }

  const db = getDb();
  const principal = await verifyApiKey(db, presented);
  const rateLimit = await enforceRateLimit(db, principal.keyId);

  if (!principal.scopes.includes(requireScope)) {
    throw new ApiError("FORBIDDEN", `This API key lacks the "${requireScope}" scope`, 403);
  }

  return { db, principal, rateLimit };
}

/**
 * Wrap a handler with authentication + the PRD's unified error shape.
 *
 * The returned function deliberately declares its second parameter as `any`:
 * Next.js validates each exported route handler's type against its generated
 * `RouteContext`, which differs between static and dynamic routes. The handler
 * itself still receives fully typed params via the `P` generic.
 */
export function withApi<P = Record<string, never>>(
  handler: (ctx: V1Context, req: Request, params: P) => Promise<Response>,
  requireScope: ApiKeyScope = "read"
) {
  return async function route(req: Request, segment: any): Promise<Response> {
    try {
      const ctx = await authenticate(req, requireScope);
      const params: P = segment ? await segment.params : ({} as P);
      const res = await handler(ctx, req, params);

      // Advertise the caller's remaining quota on every successful response.
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(rateLimitHeaders(ctx.rateLimit))) headers.set(k, v);
      return withCors(new Response(res.body, { status: res.status, statusText: res.statusText, headers }));
    } catch (e) {
      return withCors(errorResponse(e));
    }
  };
}

/**
 * CORS for third-party integrations. `Origin: *` is safe here because API keys
 * are sent explicitly by the caller and we never rely on cookies, so a browser
 * cannot be tricked into leaking a user's data via ambient credentials.
 */
export function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, x-api-key");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Shared OPTIONS preflight handler for the /api/v1 surface. */
export function preflight(): Response {
  return withCors(new Response(null, { status: 204 }));
}

/* ============================ serialisation ============================ */

type TaskRow = typeof tasks.$inferSelect;

/** Stable, documented public task shape. */
export type PublicTask = {
  id: string;
  boardId: string;
  statusId: string;
  title: string;
  description: string | null;
  priority: number;
  progress: number;
  status: "pending" | "done";
  startDate: string | null;
  dueDate: string | null;
  dueTime: string | null;
  completedAt: string | null;
  isOverdue: boolean;
  daysUntilDue: number | null;
  remindersMuted: boolean;
  remindOnStart: boolean;
  remindLeadMinutes: number | null;
  labels?: { id: string; name: string; color: string }[];
  createdAt: string;
  updatedAt: string;
};

/** Whole days until the due date (negative = overdue), in UTC date terms. */
export function daysUntil(dueDate: string | null, today: string): number | null {
  if (!dueDate) return null;
  const a = Date.parse(`${dueDate}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

export function serializeTask(
  task: TaskRow,
  today: string,
  labels?: { id: string; name: string; color: string }[]
): PublicTask {
  const days = daysUntil(task.dueDate, today);
  return {
    id: task.id,
    boardId: task.boardId,
    statusId: task.statusId,
    title: task.title,
    description: task.description,
    priority: task.priority,
    progress: task.progress,
    status: task.completedAt ? "done" : "pending",
    startDate: task.startDate,
    dueDate: task.dueDate,
    dueTime: task.dueTime ? String(task.dueTime).slice(0, 5) : null,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    isOverdue: !task.completedAt && days !== null && days < 0,
    daysUntilDue: task.completedAt ? null : days,
    remindersMuted: task.remindersMuted,
    remindOnStart: task.remindOnStart,
    remindLeadMinutes: task.remindLeadMinutes,
    ...(labels ? { labels } : {}),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

/** Today's date (YYYY-MM-DD) in the user's timezone. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Clamp a client-supplied limit. */
export function parseLimit(raw: string | null, fallback = 100, max = 500): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/** Validate a `YYYY-MM-DD` date string. */
export function assertDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new ApiError("BAD_REQUEST", `${field} must be formatted YYYY-MM-DD`);
  }
  // Reject impossible calendar dates (e.g. 2026-02-30) — Date.parse rolls them
  // over to the next month instead of failing, so round-trip and compare.
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new ApiError("BAD_REQUEST", `${field} is not a valid calendar date`);
  }
  return s;
}
