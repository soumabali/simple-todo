import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse, ApiError } from "@/lib/session";
import { getOwnedStatus } from "@/lib/domain";
import { statuses } from "@/db/schema";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/statuses/:id/move — reorder a column (PRD F-3.4). */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    await getOwnedStatus(db, id, session.user.id);

    const body = await req.json();
    const position = Number(body.position);
    if (!Number.isFinite(position)) throw new ApiError("BAD_REQUEST", "Invalid position");

    const [updated] = await db
      .update(statuses)
      .set({ position: String(position), updatedAt: new Date() })
      .where(eq(statuses.id, id))
      .returning();

    return NextResponse.json({ status: updated });
  } catch (e) {
    return errorResponse(e);
  }
}
