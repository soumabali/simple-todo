import { auth } from "@/lib/auth";
import { headers } from "next/headers";

/**
 * Server-side session helpers. Every route handler / server action MUST use
 * requireUser / requireAdmin so no endpoint ever trusts a client-supplied userId.
 */
export async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new ApiError("UNAUTHORIZED", "Not authenticated", 401);
  return session;
}

export async function requireAdmin() {
  const session = await requireUser();
  if (session.user.role !== "admin") {
    // PRD: admin routes return 404, not 403.
    throw new ApiError("NOT_FOUND", "Not found", 404);
  }
  return session;
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Unified error shape per PRD §9: { error: { code, message } }. */
export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return Response.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status }
    );
  }
  console.error("Unhandled error:", err);
  return Response.json(
    { error: { code: "INTERNAL", message: "Internal server error" } },
    { status: 500 }
  );
}
