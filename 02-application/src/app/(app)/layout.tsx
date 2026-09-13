import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

/**
 * Server layout for authenticated pages (runs on the Node runtime).
 * Does full session validation — forced password change and admin-only
 * redirects (404 semantics) that the edge middleware cannot.
 */
export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  const user = session.user as any;

  // Forced password change (PRD F-1.3).
  if (user.mustChangePassword) {
    redirect("/change-password");
  }

  // Admin-only routes: non-admins are sent to /boards (the middleware
  // already gates, but double-check here for the 404 semantics).
  // (Route-level enforcement is in requireAdmin on each /api/admin/* route.)

  return <AppShell initialUser={user}>{children}</AppShell>;
}
