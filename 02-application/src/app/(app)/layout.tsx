import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { decideShell } from "@/lib/access";
import { AppShell } from "@/components/app-shell";

/**
 * Server layout for authenticated pages (runs on the Node runtime).
 *
 * The rules live in `@/lib/access` as a pure function so they can be unit
 * tested; this file only wires them to the session and the `x-pathname` header
 * that the middleware sets.
 *
 * None of these gates can live in the edge middleware: it is Edge-safe, so it
 * cannot import better-auth to read the session, and it can only check that a
 * session cookie is *present*.
 */
export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });

  const decision = decideShell(session, h.get("x-pathname") ?? "");

  if (decision.action === "redirect") {
    redirect(decision.to);
  }
  if (decision.action === "notFound") {
    // PRD: 404 rather than 403, so the admin area's existence is not disclosed.
    notFound();
  }

  return <AppShell initialUser={session!.user as any}>{children}</AppShell>;
}
