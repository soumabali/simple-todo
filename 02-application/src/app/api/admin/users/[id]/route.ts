import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireAdmin, errorResponse, ApiError } from "@/lib/session";
import { auth } from "@/lib/auth";
import { user, activityLogs, notificationQueue } from "@/db/schema";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/admin/users/:id — edit name/email/role (PRD F-8.3). */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireAdmin();
    const db = getDb();

    const target = await db.query.user.findFirst({ where: (u, { eq: e }) => e(u.id, id) });
    if (!target) throw new ApiError("NOT_FOUND", "User not found", 404);

    const body = await req.json();
    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (body.name !== undefined) patch.name = String(body.name);
    if (body.role !== undefined) {
      // An admin cannot demote their own account (PRD §M8 safeguards).
      if (id === session.user.id && body.role !== "admin") {
        throw new ApiError("BAD_REQUEST", "You cannot demote your own account");
      }
      patch.role = body.role === "admin" ? "admin" : "user";
    }
    if (body.email !== undefined) {
      patch.email = String(body.email).trim().toLowerCase();
      // Changing email revokes sessions (PRD F-8.3).
      const ctx = await auth.$context;
      const sessions = await ctx.internalAdapter.listSessions(id);
      for (const s of sessions) {
        await ctx.internalAdapter.deleteSession(s.id);
      }
    }
    if (body.banned !== undefined) {
      if (id === session.user.id && body.banned) {
        throw new ApiError("BAD_REQUEST", "You cannot deactivate your own account");
      }
      patch.banned = Boolean(body.banned);
      patch.banReason = body.banReason ?? null;
      patch.banExpires = body.banExpires ?? null;

      if (body.banned) {
        // Deactivating revokes sessions + cancels pending notifications (F-8.5).
        const ctx = await auth.$context;
        const sessions = await ctx.internalAdapter.listSessions(id);
        for (const s of sessions) await ctx.internalAdapter.deleteSession(s.id);
        await db
          .update(notificationQueue)
          .set({ status: "cancelled" })
          .where(eq(notificationQueue.userId, id));
      }
    }

    const [updated] = await db.update(user).set(patch).where(eq(user.id, id)).returning();
    await logActivity(db, session.user.id, "user.update", "user", id, { patch: Object.keys(patch) });

    return NextResponse.json({
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role,
        banned: updated.banned,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/admin/users/:id — requires the email confirmation (PRD F-8.6). */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireAdmin();
    const db = getDb();

    if (id === session.user.id) {
      throw new ApiError("BAD_REQUEST", "You cannot delete your own account");
    }

    const target = await db.query.user.findFirst({ where: (u, { eq: e }) => e(u.id, id) });
    if (!target) throw new ApiError("NOT_FOUND", "User not found", 404);

    const ctx = await auth.$context;
    await ctx.internalAdapter.deleteUser(id);
    await logActivity(db, session.user.id, "user.delete", "user", id, { email: target.email });

    return NextResponse.json({ deleted: id });
  } catch (e) {
    return errorResponse(e);
  }
}

async function logActivity(db: ReturnType<typeof getDb>, actorId: string, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>) {
  await db.insert(activityLogs).values({ actorId, action, entityType, entityId, metadata });
}
