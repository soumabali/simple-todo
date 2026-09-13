import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireAdmin, errorResponse, ApiError } from "@/lib/session";
import { auth } from "@/lib/auth";
import { user, activityLogs } from "@/db/schema";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

/** POST /api/admin/users/:id/reset-password — generate a new one, revoke sessions (PRD F-8.4). */
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireAdmin();
    const db = getDb();

    const target = await db.query.user.findFirst({ where: (u, { eq: e }) => e(u.id, id) });
    if (!target) throw new ApiError("NOT_FOUND", "User not found", 404);

    const password = generatePassword();

    const ctx = await auth.$context;
    // Revoke all sessions for this user.
    const sessions = await ctx.internalAdapter.listSessions(id);
    for (const s of sessions) await ctx.internalAdapter.deleteSession(s.id);

    // Update password hash + force change on next login.
    // Note: updatePassword expects the HASHED password (writes to account.password).
    const hash = await ctx.password.hash(password);
    await ctx.internalAdapter.updatePassword(id, hash);
    await db.update(user).set({ mustChangePassword: true, updatedAt: new Date() }).where(eq(user.id, id));

    await db.insert(activityLogs).values({
      actorId: session.user.id,
      action: "user.reset_password",
      entityType: "user",
      entityId: id,
    });

    return NextResponse.json({ password });
  } catch (e) {
    return errorResponse(e);
  }
}

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  let pwd = letters[Math.floor(Math.random() * letters.length)];
  pwd += digits[Math.floor(Math.random() * digits.length)];
  for (let i = 0; i < 10; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  return pwd.split("").sort(() => Math.random() - 0.5).join("");
}
