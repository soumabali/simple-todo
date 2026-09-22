import { describe, expect, it } from "vitest";
import { ApiError, errorResponse } from "@/lib/api-error";

/**
 * `errorResponse` is the single place every route turns a thrown error into a
 * response, so its classification decides what the user sees.
 *
 * Before the 2026-09-21 fix, an exhausted Neon retry became `500 INTERNAL`
 * ("Internal server error") — indistinguishable from a genuine bug, and with no
 * hint that retrying is the right move.
 */

async function read(err: unknown) {
  const res = errorResponse(err);
  return { status: res.status, body: await res.json(), headers: res.headers };
}

describe("errorResponse", () => {
  it("passes an ApiError through with its own status and code", async () => {
    const r = await read(new ApiError("NOT_FOUND", "Board not found", 404));
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: { code: "NOT_FOUND", message: "Board not found" } });
  });

  it("answers 503 + Retry-After for a transient upstream failure", async () => {
    // Mutation: drop the isTransientDbError branch → status becomes 500.
    const r = await read(new Error("Failed query: select 1 from boards"));
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(r.headers.get("retry-after")).toBe("2");
  });

  it("answers 503 for a hung-query timeout too", async () => {
    const e = new Error("neon query timed out after 8000ms");
    e.name = "TimeoutError";
    const r = await read(e);
    expect(r.status).toBe(503);
  });

  it("still answers 500 for a genuine, non-transient bug", async () => {
    // A unique violation is deterministic: retrying will not help, and calling
    // it "temporarily unavailable" would be a lie.
    const dup = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
    });
    const r = await read(dup);
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe("INTERNAL");
  });

  it("answers 500 for a plain unexpected error", async () => {
    const r = await read(new TypeError("cannot read properties of undefined"));
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe("INTERNAL");
  });

  it("does not leak the internal error message to the client", async () => {
    const r = await read(new Error("secret-internal-detail-xyz"));
    expect(JSON.stringify(r.body)).not.toContain("secret-internal-detail-xyz");
  });
});
