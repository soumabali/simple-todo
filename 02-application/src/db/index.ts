import { drizzle } from "drizzle-orm/node-postgres";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { neon, neonConfig } from "@neondatabase/serverless";
import { Pool } from "pg";
import { withRetry } from "@/lib/db-resilience";
import * as schema from "./schema";

export { schema };

export type DB = ReturnType<typeof createDb>;

/**
 * Attempt/timeout budget for one Neon HTTP query.
 *
 * Production incident (2026-09-21): a query would occasionally hang 25–85s and
 * then reject, while the healthy median for the same request was 1.2s. The
 * failure did not correlate with load — 1/12 requests failed when issued one at
 * a time, 0/15 when issued 5-at-a-time — and the queries that failed included
 * the cheapest possible one (`where false`). So this was the connection layer,
 * not our SQL, and one flaky fetch was taking down whole routes with a generic
 * 500 on ~5% of dashboard loads.
 *
 * 8s per attempt × 3 attempts worst-cases at ~24s plus backoff — deliberately
 * shorter than the 85s hang we observed, so the user gets a fast, honest 503
 * rather than an edge-level timeout with no `cf-ray`.
 */
export const NEON_FETCH_ATTEMPTS = 3;
export const NEON_FETCH_TIMEOUT_MS = 8_000;

/**
 * `fetch` wrapper installed into `neonConfig.fetchFunction`.
 *
 * Retrying at this layer (rather than around each Drizzle call) catches every
 * query the driver makes, including ones added to a route later. `withRetry`
 * only retries errors `isTransientDbError` recognises, so a real SQL error
 * (unique violation, syntax error) still fails immediately instead of being
 * sent three times.
 */
export const resilientFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> =>
  withRetry(() => fetch(input, init), {
    attempts: NEON_FETCH_ATTEMPTS,
    timeoutMs: NEON_FETCH_TIMEOUT_MS,
    label: "neon query",
  });

/**
 * Creates a Drizzle client bound to the given connection string.
 *
 * We support two drivers:
 *  - Local dev / CI (Docker Postgres): node-postgres (`pg`)
 *  - Cloudflare Workers / Neon: `@neondatabase/serverless` (HTTP)
 *
 * On the workerd runtime there is no TCP Postgres, so we detect the platform
 * and pick the right client. `node-postgres` only runs under Node.
 */
export function createDb(url: string) {
  const isWorker =
    typeof process === "undefined" || (globalThis as any).navigator?.userAgent === "Cloudflare-Workers";

  if (!isWorker) {
    const pool = new Pool({ connectionString: url, max: 10 });
    return drizzle(pool, { schema });
  }

  // The neon-http driver issues one HTTP fetch per query; route every one of
  // them through the resilient wrapper. Installed on the singleton config so it
  // also covers queries the driver makes internally.
  neonConfig.fetchFunction = resilientFetch;
  const client = neon(url);
  return drizzleHttp(client, { schema });
}

/* Singleton for the Node/Next.js server runtime. */
let _db: ReturnType<typeof createDb> | null = null;
export function getDb(): ReturnType<typeof createDb> {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _db = createDb(url);
  }
  return _db;
}
