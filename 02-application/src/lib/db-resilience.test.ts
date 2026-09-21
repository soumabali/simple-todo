import { describe, expect, it, vi } from "vitest";
import {
  isTransientDbError,
  withRetry,
  withTimeout,
} from "@/lib/db-resilience";

/**
 * These tests exist because of a production incident: `neon-http` fetches
 * occasionally hung for 25–85s and then rejected, and every route turned that
 * into a generic 500 (issue "500 intermiten", 2026-09-21).
 *
 * A test that only asserted "withRetry returns the value" would pass against a
 * `withRetry` that retries nothing at all. So each test below pins the
 * behaviour that the incident depended on, and the mutation that would break it
 * is named in a comment.
 */

const never = () => new Promise<never>(() => {});
const sleepNoop = () => Promise.resolve();

describe("withTimeout", () => {
  it("rejects with a TimeoutError when the operation hangs", async () => {
    // Mutation: drop the Promise.race → this hangs until vitest's own timeout.
    await expect(withTimeout(never(), 20, "db query")).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("resolves normally when the operation is fast", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50, "db query")).resolves.toBe("ok");
  });

  it("propagates the original rejection rather than masking it", async () => {
    const boom = new Error("kaboom");
    await expect(withTimeout(Promise.reject(boom), 50, "db query")).rejects.toBe(boom);
  });

  it("does not leave a pending timer behind after success", async () => {
    vi.useFakeTimers();
    try {
      await withTimeout(Promise.resolve(1), 10_000, "db query");
      // If the timer leaked, there would be a pending timer here.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("isTransientDbError", () => {
  it("treats a hung/timed-out query as transient", () => {
    const e = new Error("db query timed out after 12000ms");
    e.name = "TimeoutError";
    expect(isTransientDbError(e)).toBe(true);
  });

  it("treats drizzle's 'Failed query' wrapper as transient", () => {
    // This is the exact text seen in the production wrangler tail.
    expect(
      isTransientDbError(new Error('Failed query: select "id" from "boards" where "boards"."id" = $1'))
    ).toBe(true);
  });

  it("treats connection-loss and pooler exhaustion as transient", () => {
    for (const msg of [
      "Connection terminated unexpectedly",
      "read ECONNRESET",
      "socket hang up",
      "fetch failed",
      "remaining connection slots are reserved",
      "too many clients already",
    ]) {
      expect(isTransientDbError(new Error(msg)), msg).toBe(true);
    }
  });

  it("finds the code/message through a wrapped cause", () => {
    const inner = Object.assign(new Error("read ETIMEDOUT"), { code: "ETIMEDOUT" });
    const outer = new Error("Failed query: select 1");
    (outer as { cause?: unknown }).cause = inner;
    expect(isTransientDbError(outer)).toBe(true);
  });

  it("NEVER treats a unique violation as transient", () => {
    // Regression guard for BUG-10: a duplicate label must become a 400 straight
    // away, not be retried three times and then surface as a 500.
    const e = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
    });
    expect(isTransientDbError(e)).toBe(false);
  });

  it("NEVER treats a deterministic SQL error as transient", () => {
    for (const code of ["23503", "42703", "42601", "22P02", "42501"]) {
      const e = Object.assign(new Error("some failure"), { code });
      expect(isTransientDbError(e), code).toBe(false);
    }
  });

  it("lets a FATAL code win over a misleading message", () => {
    // A check_violation whose message happens to mention a timeout must not be
    // retried: the code is consulted before the message patterns.
    // Mutation that reddens this: delete the `FATAL_SQLSTATES` check
    // (verified — 2 tests fail when it is removed).
    const e = Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "23514",
    });
    expect(isTransientDbError(e)).toBe(false);
  });

  it("a fatal code beats a transient-looking message", () => {
    // The interesting case: message says "connection terminated" (a transient
    // pattern) while the code is fatal. Code must win.
    // Mutation that reddens this: delete the `FATAL_SQLSTATES` check.
    const e = Object.assign(new Error("Failed query: connection terminated"), {
      code: "23514",
    });
    expect(isTransientDbError(e)).toBe(false);
  });

  it("returns false for junk input instead of throwing", () => {
    expect(isTransientDbError(null)).toBe(false);
    expect(isTransientDbError(undefined)).toBe(false);
    expect(isTransientDbError(42)).toBe(false);
    expect(isTransientDbError({})).toBe(false);
  });
});

describe("withRetry", () => {
  it("retries a transient failure and then succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("fetch failed");
        return "recovered";
      },
      { attempts: 3, sleep: sleepNoop }
    );
    expect(result).toBe("recovered");
    expect(calls).toBe(3);
  });

  it("gives up after the configured attempts and rethrows the real error", async () => {
    let calls = 0;
    const err = new Error("Connection terminated unexpectedly");
    await expect(
      withRetry(async () => { calls++; throw err; }, { attempts: 3, sleep: sleepNoop })
    ).rejects.toBe(err);
    expect(calls).toBe(3);
  });

  it("does NOT retry a deterministic error", async () => {
    // Mutation: make withRetry ignore isTransientDbError → calls becomes 3.
    let calls = 0;
    const dup = Object.assign(new Error("duplicate key value"), { code: "23505" });
    await expect(
      withRetry(async () => { calls++; throw dup; }, { attempts: 3, sleep: sleepNoop })
    ).rejects.toBe(dup);
    expect(calls).toBe(1);
  });

  it("times out a hung attempt and retries it rather than hanging forever", async () => {
    // This is the incident, reproduced: attempt 1 hangs, attempt 2 succeeds.
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls === 1) return never();
        return "second attempt won";
      },
      { attempts: 3, timeoutMs: 25, sleep: sleepNoop }
    );
    expect(result).toBe("second attempt won");
    expect(calls).toBe(2);
  });

  it("backs off exponentially, capped at 2s", async () => {
    const delays: number[] = [];
    await expect(
      withRetry(async () => { throw new Error("fetch failed"); },
        { attempts: 4, baseDelayMs: 100, timeoutMs: 1, label: "q", sleep: async (ms) => { delays.push(ms); } })
    ).rejects.toThrow();
    expect(delays).toEqual([100, 200, 400]);
  });

  it("passes the value through untouched when there is no failure", async () => {
    let calls = 0;
    const out = await withRetry(async () => { calls++; return { n: 7 }; }, { sleep: sleepNoop });
    expect(out).toEqual({ n: 7 });
    expect(calls).toBe(1);
  });
});
