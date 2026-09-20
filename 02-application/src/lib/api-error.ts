/**
 * Error primitives shared by every API surface (session and API-key alike).
 *
 * Kept in its own module — with no database or better-auth imports — so pure
 * helpers and unit tests can use them without a DATABASE_URL.
 */

export class ApiError extends Error {
  code: string;
  status: number;
  headers?: Record<string, string>;
  constructor(code: string, message: string, status = 400, headers?: Record<string, string>) {
    super(message);
    this.code = code;
    this.status = status;
    this.headers = headers;
  }
}

/** Unified error shape per PRD §9: { error: { code, message } }. */
export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return Response.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status, headers: err.headers }
    );
  }
  console.error("Unhandled error:", err);
  return Response.json(
    { error: { code: "INTERNAL", message: "Internal server error" } },
    { status: 500 }
  );
}
