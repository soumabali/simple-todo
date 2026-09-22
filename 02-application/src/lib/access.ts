/**
 * Authorization rules for the authenticated app shell.
 *
 * Kept as a pure function (no `next/headers`, no session fetch) so the rules can
 * be unit-tested directly. The layout wires it to the live session and the
 * `x-pathname` header set by the middleware.
 */

/** Paths under /admin that require role === "admin". */
export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export type ShellDecision =
  | { action: "redirect"; to: "/login" | "/change-password" }
  | { action: "notFound" }
  | { action: "allow" };

export interface ShellUser {
  role?: string | null;
  mustChangePassword?: boolean | null;
}

/**
 * The single place that decides what the app shell does with a request.
 *
 * Order matters: an unauthenticated request must not be told about
 * /change-password, and a forced-password-change user must be routed there
 * before the admin check can mask it as 404.
 *
 * `pathname` is "" when the header is absent (direct render without the
 * middleware). That yields "allow", deliberately: failing open here only skips
 * the admin page gate, while every /api/admin/* route independently enforces
 * `requireAdmin`, so no data is reachable. Failing closed would 404 the whole
 * app whenever the header is missing.
 */
export function decideShell(
  session: { user: ShellUser } | null | undefined,
  pathname: string,
): ShellDecision {
  if (!session) {
    return { action: "redirect", to: "/login" };
  }

  if (session.user.mustChangePassword) {
    return { action: "redirect", to: "/change-password" };
  }

  // PRD: admin-only pages return 404 rather than 403, so the admin area's
  // existence is not disclosed. Mirrors `requireAdmin` for /api/admin/*.
  if (isAdminPath(pathname) && session.user.role !== "admin") {
    return { action: "notFound" };
  }

  return { action: "allow" };
}
