import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { ApiError } from "@/lib/api-error";

// Re-exported so existing imports (`@/lib/session`) keep working unchanged.
export { ApiError, errorResponse } from "@/lib/api-error";

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
