import { describe, it, expect } from "vitest";
import { decideShell, isAdminPath } from "@/lib/access";

/**
 * Regression guard for the admin page gate.
 *
 * WHAT WENT WRONG
 * ---------------
 * The `(app)/layout.tsx` admin check was a COMMENT describing the intent, with
 * no code beneath it:
 *
 *     // Admin-only routes: non-admins are sent to /boards (the middleware
 *     // already gates, but double-check here for the 404 semantics).
 *
 * The edge middleware cannot gate them either — it is Edge-safe, so it cannot
 * import better-auth to read the session, and it only checks that a cookie is
 * *present*. Result: a signed-in non-admin received HTTP 200 and a fully
 * rendered admin shell (heading, "+ Add user" button) whose table was empty
 * because the API answered 404. That reads as a broken app, not a permission
 * boundary.
 */

describe("isAdminPath", () => {
  it("matches /admin and everything under it", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/users")).toBe(true);
    expect(isAdminPath("/admin/logs")).toBe(true);
  });

  it("does not match similarly-prefixed siblings", () => {
    expect(isAdminPath("/administrator")).toBe(false);
    expect(isAdminPath("/boards")).toBe(false);
    expect(isAdminPath("/")).toBe(false);
  });
});

describe("decideShell", () => {
  const admin = { user: { role: "admin" } };
  const user = { user: { role: "user" } };

  it("sends an anonymous request to /login", () => {
    expect(decideShell(null, "/boards")).toEqual({ action: "redirect", to: "/login" });
  });

  // This is the case the maintainer hit: role=user, path=/admin/users.
  it("returns notFound for a non-admin on an admin page", () => {
    expect(decideShell(user, "/admin/users")).toEqual({ action: "notFound" });
    expect(decideShell(user, "/admin/logs")).toEqual({ action: "notFound" });
    expect(decideShell(user, "/admin")).toEqual({ action: "notFound" });
  });

  it("allows an admin on an admin page", () => {
    expect(decideShell(admin, "/admin/users")).toEqual({ action: "allow" });
  });

  it("allows a non-admin on regular pages", () => {
    expect(decideShell(user, "/boards")).toEqual({ action: "allow" });
  });

  it("routes a forced password change before the admin check", () => {
    // Order matters: otherwise an admin with a pending change would reach
    // /admin instead of being forced to /change-password.
    expect(decideShell({ user: { role: "admin", mustChangePassword: true } }, "/admin/users"))
      .toEqual({ action: "redirect", to: "/change-password" });
    expect(decideShell({ user: { role: "admin", mustChangePassword: true } }, "/boards"))
      .toEqual({ action: "redirect", to: "/change-password" });
  });

  it("never reports /login for a forced password change", () => {
    // A missing-then-authenticated user must not be bounced to /login.
    expect(decideShell({ user: { mustChangePassword: true } }, "/boards"))
      .toEqual({ action: "redirect", to: "/change-password" });
  });

  it("treats a missing role as non-admin", () => {
    expect(decideShell({ user: {} }, "/admin/users")).toEqual({ action: "notFound" });
  });

  it("fails open when the pathname header is absent", () => {
    // Documented trade-off: skipping the page gate leaks no data because
    // requireAdmin guards every /api/admin/* route. Failing closed would 404
    // the entire app whenever the header is missing.
    expect(decideShell(admin, "")).toEqual({ action: "allow" });
    expect(decideShell(user, "")).toEqual({ action: "allow" });
  });
});
