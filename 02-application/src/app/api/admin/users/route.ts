import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireAdmin, errorResponse, ApiError } from "@/lib/session";
import { auth } from "@/lib/auth";
import { user, notificationSettings, activityLogs } from "@/db/schema";
import { count } from "drizzle-orm";

/**
 * GET /api/admin/users?q=&role=&status=&page=
 * List users, 25 per page. requireAdmin returns 404 for non-admins (PRD §M8).
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const db = getDb();
    const q = req.nextUrl.searchParams.get("q") ?? "";
    const role = req.nextUrl.searchParams.get("role") ?? "";
    const status = req.nextUrl.searchParams.get("status") ?? "";
    const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1"));
    const limit = 25;
    const offset = (page - 1) * limit;

    const list = await db.query.user.findMany({
      where: (u, { eq: e, ilike: il, or: o, and: a }) => {
        const c: any[] = [];
        if (q) c.push(o(il(u.email, `%${q}%`), il(u.name, `%${q}%`)));
        if (role) c.push(e(u.role, role));
        if (status === "active") c.push(e(u.banned, false));
        if (status === "deactivated") c.push(e(u.banned, true));
        return c.length ? a(...c) : undefined;
      },
      orderBy: (u, { desc: d }) => d(u.createdAt),
      limit,
      offset,
    });

    const [totalRow] = await db.select({ value: count() }).from(user);
    const total = totalRow?.value ?? 0;

    // Strip sensitive fields.
    const safe = list.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      banned: u.banned,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    }));

    return NextResponse.json({ users: safe, total, page, pageSize: limit });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST /api/admin/users — create a user (PRD §8.6). */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    const db = getDb();
    const body = await req.json();

    const email = String(body.email ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim();
    const role = body.role === "admin" ? "admin" : "user";
    if (!email || !name) throw new ApiError("BAD_REQUEST", "Name and email are required");

    const existing = await db.query.user.findFirst({
      where: (u, { eq: e }) => e(u.email, email),
    });
    if (existing) throw new ApiError("BAD_REQUEST", "Email already exists");

    const password = body.password || generatePassword();

    const ctx = await auth.$context;
    const created = (await ctx.internalAdapter.createUser(
      {
        email,
        name,
        emailVerified: true,
        role,
        timezone: "Asia/Makassar",
        mustChangePassword: true,
        banned: false,
      } as any,
      { method: "admin" }
    )) as any;

    const hash = await ctx.password.hash(password);
    await ctx.internalAdapter.linkAccount({
      userId: created.id,
      providerId: "credential",
      accountId: created.id,
      password: hash,
    });

    await db.insert(notificationSettings).values({ userId: created.id });

    await logActivity(db, session.user.id, "user.create", "user", created.id, { email, role });

    return NextResponse.json(
      { user: { id: created.id, email, name, role }, password },
      { status: 201 }
    );
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

async function logActivity(db: ReturnType<typeof getDb>, actorId: string, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>) {
  await db.insert(activityLogs).values({ actorId, action, entityType, entityId, metadata });
}
