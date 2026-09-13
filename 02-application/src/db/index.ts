import { drizzle } from "drizzle-orm/node-postgres";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { Pool } from "pg";
import * as schema from "./schema";

export { schema };

export type DB = ReturnType<typeof createDb>;

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
  return drizzleHttp(url, { schema });
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
