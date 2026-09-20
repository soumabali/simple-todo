import { NextResponse } from "next/server";
import { withApi, preflight } from "@/lib/api-v1";

/**
 * GET /api/v1/me — identity of the API key owner.
 * Handy for integrations to verify a key works and discover the user's timezone.
 */
export const GET = withApi(async ({ db, principal }) => {
  const user = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, principal.userId),
    columns: { id: true, name: true, email: true, timezone: true },
  });

  return NextResponse.json({
    user: {
      id: user?.id ?? principal.userId,
      name: user?.name ?? null,
      email: user?.email ?? null,
      timezone: user?.timezone ?? "Asia/Makassar",
    },
    apiKey: { id: principal.keyId, name: principal.name, prefix: principal.prefix, scopes: principal.scopes },
  });
});

export const OPTIONS = () => preflight();
