import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse, ApiError } from "@/lib/session";
import { getOwnedBoard } from "@/lib/domain";
import { labels } from "@/db/schema";

type Params = { params: Promise<{ id: string }> };

/** POST /api/boards/:id/labels — create a label. */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const db = getDb();
    await getOwnedBoard(db, id, session.user.id);

    const body = await req.json();
    const name = String(body.name ?? "").trim();
    if (!name) throw new ApiError("BAD_REQUEST", "Name is required");

    // Duplicate names are rejected with a friendly 400 rather than the DB
    // unique-constraint 500 (BUG-10). Race-safe: catch 23505 as a fallback.
    const existing = await db.query.labels.findFirst({
      where: (l, { eq: e }) => e(l.boardId, id) && e(l.name, name),
    });
    if (existing) throw new ApiError("BAD_REQUEST", "Label already exists");

    const [label] = await db
      .insert(labels)
      .values({ boardId: id, name, color: body.color ?? "slate" })
      .returning();

    return NextResponse.json({ label }, { status: 201 });
  } catch (e) {
    if ((e as any)?.code === "23505") {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Label already exists" } },
        { status: 400 }
      );
    }
    return errorResponse(e);
  }
}
