import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireAdmin, errorResponse } from "@/lib/session";
import { activityLogs, user } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

/** GET /api/admin/logs?page= — activity log (read-only, PRD §10.5). */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const db = getDb();
    const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1"));
    const limit = 50;
    const offset = (page - 1) * limit;

    const rows = await db
      .select({
        id: activityLogs.id,
        actorId: activityLogs.actorId,
        actorEmail: user.email,
        actorName: user.name,
        action: activityLogs.action,
        entityType: activityLogs.entityType,
        entityId: activityLogs.entityId,
        metadata: activityLogs.metadata,
        createdAt: activityLogs.createdAt,
      })
      .from(activityLogs)
      .leftJoin(user, eq(activityLogs.actorId, user.id))
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({ logs: rows, page, pageSize: limit });
  } catch (e) {
    return errorResponse(e);
  }
}
