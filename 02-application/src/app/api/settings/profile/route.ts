import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse, ApiError } from "@/lib/session";
import { user } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET  /api/settings/profile — identity + preferences of the signed-in user.
 * PATCH /api/settings/profile — update display name and/or timezone.
 *
 * Timezone matters beyond cosmetics: reminders.ts computes every reminder
 * boundary (default time, quiet hours, "today") in this zone, so an invalid
 * value would silently shift a user's notifications (PRD F-9).
 */
export async function GET() {
  try {
    const session = await requireUser();
    const db = getDb();
    const row = await db.query.user.findFirst({
      where: (u, { eq: e }) => e(u.id, session.user.id),
      columns: { id: true, name: true, email: true, role: true, timezone: true, createdAt: true },
    });
    if (!row) throw new ApiError("NOT_FOUND", "User not found", 404);
    return Response.json({
      profile: {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        timezone: row.timezone,
        createdAt: row.createdAt,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Reject a timezone the runtime cannot format in — reminders depend on it. */
function assertTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
  } catch {
    throw new ApiError("BAD_REQUEST", `Unknown timezone: ${tz}`);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireUser();
    const db = getDb();
    const body = await req.json();
    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new ApiError("BAD_REQUEST", "Name cannot be empty");
      if (name.length > 80) throw new ApiError("BAD_REQUEST", "Name is too long (max 80)");
      patch.name = name;
    }

    if (body.timezone !== undefined) {
      const tz = String(body.timezone).trim();
      if (!tz) throw new ApiError("BAD_REQUEST", "Timezone cannot be empty");
      assertTimezone(tz);
      patch.timezone = tz;
    }

    if (Object.keys(patch).length === 1) {
      throw new ApiError("BAD_REQUEST", "Nothing to update");
    }

    const [updated] = await db
      .update(user)
      .set(patch)
      .where(eq(user.id, session.user.id))
      .returning();

    return Response.json({
      profile: updated
        ? {
            id: updated.id,
            name: updated.name,
            email: updated.email,
            role: updated.role,
            timezone: updated.timezone,
            createdAt: updated.createdAt,
          }
        : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
