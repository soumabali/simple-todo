/**
 * Resilience primitives for the Neon HTTP driver.
 *
 * WHY THIS EXISTS (production incident, 2026-09-21 — issue "500 intermiten"):
 * `drizzle-orm/neon-http` issues **one HTTP fetch per query**. In production we
 * observed a query occasionally hang for 25–85 seconds and then reject, while
 * the healthy median for the same request was 1.2 s. The failure was not
 * correlated with load — 1/12 requests failed when issued strictly one at a
 * time, and 0/15 failed when issued 5-at-a-time — and the queries that failed
 * included the cheapest possible one (`where false`). That points at the
 * connection layer (Neon pooler), not at our SQL.
 *
 * Every route then answered `500 INTERNAL`. Two consequences:
 *   1. A transient upstream blip looked like a bug in FlowBoard.
 *   2. The dashboard fires several queries per page load, so a single hung
 *      fetch took the whole page down — ~5% of loads in our measurement.
 *
 * The fix has two halves, both here so they can be unit-tested without a DB:
 *   - `withTimeout` bounds how long we wait on one upstream call.
 *   - `withRetry` retries a *transient* failure a small number of times, with
 *     backoff, instead of surfacing it.
 *   - `isTransientDbError` decides what "transient" means. It is deliberately
 *     narrow: retrying a real bug (a constraint violation, a syntax error)
 *     would multiply the damage and hide the bug.
 */

/** Errors whose text we treat as "the upstream connection hiccuped". */
const TRANSIENT_PATTERNS: RegExp[] = [
  /failed query/i, // drizzle wraps every driver error in this
  /connection (terminated|closed|reset|refused)/i,
  /econnreset|econnrefused|etimedout|epipe|enotfound|eai_again/i,
  /socket hang ?up/i,
  /fetch failed/i,
  /network connection lost/i,
  /timeout|timed out/i,
  /too many (connections|clients)/i,
  /remaining connection slots/i,
  /server (closed|unexpectedly)/i,
  /terminating connection/i,
];

/**
 * Postgres SQLSTATEs that are genuinely transient / worth one retry.
 * 08xxx = connection exception, 53xxx = insufficient resources,
 * 57P01-57P03 = admin shutdown / crash / cannot-connect-now, 40001 = serialization.
 * NOT included on purpose: 23505 (unique_violation), 42xxx (syntax/undefined),
 * 23xxx (integrity) — those are deterministic and must never be retried.
 */
const TRANSIENT_SQLSTATES = new Set([
  "08000", "08001", "08003", "08004", "08006", "08007",
  "40001", "40003",
  "53000", "53100", "53200", "53300",
  "57P01", "57P02", "57P03",
]);

/**
 * Postgres error codes that are deterministic and must NEVER be retried.
 * Checked first, so a message that happens to contain "timeout" cannot smuggle
 * a genuine integrity violation into the retry path.
 */
const FATAL_SQLSTATES = new Set([
  "23505", // unique_violation
  "23503", // foreign_key_violation
  "23502", // not_null_violation
  "23514", // check_violation
  "23P01", // exclusion_violation
  "22001", // string_data_right_truncation
  "22007", // invalid_datetime_format
  "22P02", // invalid_text_representation
  "42P01", // undefined_table
  "42703", // undefined_column
  "42601", // syntax_error
  "42501", // insufficient_privilege
  "28000", // invalid_authorization_specification
  "28P01", // invalid_password
]);

function readCode(err: unknown): string | undefined {
  let cur: unknown = err;
  // Drizzle wraps driver errors, and the driver may wrap again; walk the chain.
  for (let depth = 0; depth < 5 && cur && typeof cur === "object"; depth++) {
    const c = (cur as { code?: unknown }).code;
    if (typeof c === "string") return c;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

function readMessage(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  const parts: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur && typeof cur === "object"; depth++) {
    const m = (cur as { message?: unknown }).message;
    if (typeof m === "string") parts.push(m);
    cur = (cur as { cause?: unknown }).cause;
  }
  if (parts.length === 0) parts.push(String(err));
  return parts.join(" | ");
}

/**
 * True when the error looks like a transient upstream/connection failure.
 *
 * Deliberately conservative: a false positive costs us a retry of something
 * that will fail again; a false negative costs us a 500 the user sees. The
 * FATAL list wins over the transient patterns so that deterministic errors are
 * never retried, even if their text is misleading.
 */
export function isTransientDbError(err: unknown): boolean {
  if (err == null) return false;

  const code = readCode(err);
  if (code && FATAL_SQLSTATES.has(code)) return false;
  if (code && TRANSIENT_SQLSTATES.has(code)) return true;

  // AbortSignal.timeout / our own deadline
  if (
    typeof err === "object" &&
    err !== null &&
    ((err as { name?: string }).name === "AbortError" ||
      (err as { name?: string }).name === "TimeoutError")
  ) {
    return true;
  }

  const msg = readMessage(err);
  if (!msg) return false;
  return TRANSIENT_PATTERNS.some((re) => re.test(msg));
}

/** Rejected when `promise` has not settled within `ms`. Never leaves a timer behind. */
export async function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label = "operation"
): Promise<T> {
  if (!(ms > 0)) return await promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const e = new Error(`${label} timed out after ${ms}ms`);
          e.name = "TimeoutError";
          reject(e);
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type RetryOptions = {
  /** Total attempts, including the first. Default 3. */
  attempts?: number;
  /** First backoff delay in ms; doubles each retry. Default 150. */
  baseDelayMs?: number;
  /** Upper bound for a single attempt. Default 12_000. */
  timeoutMs?: number;
  /** Label used in the timeout error message. */
  label?: string;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Runs `fn` with a per-attempt timeout, retrying transient failures.
 *
 * A non-transient error is rethrown immediately — retrying a unique-violation
 * would just fail three times and delay the honest 400 the user should get.
 * After the final attempt the last error is rethrown, so callers still see the
 * real cause (and `errorResponse` can classify it).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 150,
    timeoutMs = 12_000,
    label = "db query",
    sleep = defaultSleep,
  } = opts;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs, label);
    } catch (err) {
      lastErr = err;
      const transient = isTransientDbError(err);
      const isLast = attempt === attempts;
      if (!transient || isLast) throw err;
      // Exponential backoff, capped so a 3rd attempt never waits absurdly long.
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), 2_000);
      await sleep(delay);
    }
  }
  throw lastErr;
}
