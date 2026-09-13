import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse, ApiError } from "@/lib/session";
import { getOwnedBoard } from "@/lib/domain";
import { statuses } from "@/db/schema";
import { eq, count } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

/** POST /api/boards/:id/statuses — create a status (max 12 per board). */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    await getOwnedBoard(db, id, session.user.id);

    const body = await req.json();
    const name = String(body.name ?? "").trim();
    if (!name) throw new ApiError("BAD_REQUEST", "Name is required");

    const [row] = await db.select({ value: count() }).from(statuses).where(eq(statuses.boardId, id));
    if ((row?.value ?? 0) >= 12) {
      throw new ApiError("BAD_REQUEST", "Maximum 12 columns per board");
    }

    // Append at end.
    const last = await db.query.statuses.findFirst({
      where: (s, { eq: e }) => e(s.boardId, id),
      orderBy: (s, { desc: d }) => d(s.position),
    });
    const position = (last ? Number(last.position) : 1000) + 1000;

    const [status] = await db
      .insert(statuses)
      .values({
        boardId: id,
        name,
        color: body.color ?? "slate",
        position: String(position),
        wipLimit: body.wipLimit ?? null,
        isDone: Boolean(body.isDone),
      })
      .returning();

    return NextResponse.json({ status }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
