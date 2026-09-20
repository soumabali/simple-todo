import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { requireUser, errorResponse, ApiError } from "@/lib/session";
import { apiKeys } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { generateApiKey, listApiKeys, isKeyActive, parseScopes } from "@/lib/api-key";

/**
 * /api/api-keys — session-authenticated management of the caller's own keys.
 *
 * These routes are for the web UI only. The keys they mint are what unlock
 * /api/v1/*. A user can only ever see and revoke their own keys.
 */

/** GET /api/api-keys — list my keys (hash never leaves the server). */
export async function GET() {
  try {
    const session = await requireUser();
    const db = getDb();
    const keys = await listApiKeys(db, session.user.id);

    return NextResponse.json({
      apiKeys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        scopes: k.scopes,
        active: isKeyActive(k),
        lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
        expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
        revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
        createdAt: k.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/api-keys — mint a key.
 * Body: { name, scopes?: ("read"|"write")[], expiresInDays?: number }
 * The plaintext key is returned exactly once, in this response.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireUser();
    const db = getDb();
    const body = await req.json().catch(() => ({}));

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new ApiError("BAD_REQUEST", "name is required");
    if (name.length > 80) throw new ApiError("BAD_REQUEST", "name must be at most 80 characters");

    const scopes = parseScopes(body.scopes);

    let expiresAt: Date | null = null;
    if (body.expiresInDays !== undefined && body.expiresInDays !== null) {
      const days = Number(body.expiresInDays);
      if (!Number.isFinite(days) || days <= 0 || days > 3650) {
        throw new ApiError("BAD_REQUEST", "expiresInDays must be between 1 and 3650");
      }
      expiresAt = new Date(Date.now() + days * 86_400_000);
    }

    const { plaintext, prefix, keyHash } = await generateApiKey();

    const [created] = await db
      .insert(apiKeys)
      .values({ userId: session.user.id, name, prefix, keyHash, scopes, expiresAt })
      .returning();

    // `key` is the only time the plaintext is ever emitted.
    return NextResponse.json(
      {
        apiKey: {
          id: created.id,
          name: created.name,
          prefix: created.prefix,
          scopes: created.scopes,
          expiresAt: created.expiresAt ? created.expiresAt.toISOString() : null,
          createdAt: created.createdAt.toISOString(),
        },
        key: plaintext,
        warning: "Store this key now — it cannot be shown again.",
      },
      { status: 201 }
    );
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/api-keys?id=<uuid> — revoke one of my keys. */
export async function DELETE(req: NextRequest) {
  try {
    const session = await requireUser();
    const db = getDb();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) throw new ApiError("BAD_REQUEST", "id is required");

    const [revoked] = await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, session.user.id)))
      .returning();

    if (!revoked) throw new ApiError("NOT_FOUND", "API key not found", 404);

    return NextResponse.json({ revoked: revoked.id });
  } catch (e) {
    return errorResponse(e);
  }
}
