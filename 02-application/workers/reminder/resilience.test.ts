import { describe, expect, it, vi, afterEach } from "vitest";
import { isTransientDbError, resilientFetch } from "../../workers/reminder/index";

/**
 * The cron Worker hits the same Neon pooler as the web Worker, so it is exposed
 * to the same intermittent hang that took ~5% of board page loads down in
 * production (issue #19). These tests pin the worker-side copy of the
 * resilience primitives so the two copies cannot drift silently.
 */

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const ok = () => new Response("{}", { status: 200 });

describe("reminder worker: isTransientDbError", () => {
  it("treats a hung-query timeout as transient", () => {
    const e = new Error("neon query timed out after 8000ms");
    e.name = "TimeoutError";
    expect(isTransientDbError(e)).toBe(true);
  });

  it("treats drizzle's Failed-query wrapper as transient", () => {
    expect(isTransientDbError(new Error("Failed query: select 1"))).toBe(true);
  });

  it("never treats a unique violation as transient", () => {
    // The reminder worker claims rows with a conditional UPDATE; a constraint
    // error there is deterministic and must not be retried.
    expect(
      isTransientDbError(
        Object.assign(new Error("duplicate key value violates unique constraint"), {
          code: "23505",
        })
      )
    ).toBe(false);
  });

  it("never treats a deterministic SQL error as transient", () => {
    for (const code of ["23503", "42703", "42601", "22P02", "42501"]) {
      expect(isTransientDbError(Object.assign(new Error("x"), { code })), code).toBe(false);
    }
  });

  it("finds the code through a wrapped cause", () => {
    const inner = Object.assign(new Error("read ETIMEDOUT"), { code: "ETIMEDOUT" });
    const outer = new Error("Failed query: select 1");
    (outer as { cause?: unknown }).cause = inner;
    expect(isTransientDbError(outer)).toBe(true);
  });

  it("returns false for junk instead of throwing", () => {
    expect(isTransientDbError(null)).toBe(false);
    expect(isTransientDbError(undefined)).toBe(false);
    expect(isTransientDbError(7)).toBe(false);
  });
});

describe("reminder worker: resilientFetch", () => {
  it("returns the response when the upstream is healthy", async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return ok(); }) as typeof fetch;
    const res = await resilientFetch(new Request("https://example.test/x"));
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("retries a transient rejection and then succeeds", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls < 3) throw new Error("fetch failed");
      return ok();
    }) as typeof fetch;
    const res = await resilientFetch(new Request("https://example.test/x"));
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });

  it("does NOT retry a deterministic failure", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw Object.assign(new Error("duplicate key value"), { code: "23505" });
    }) as typeof fetch;
    await expect(resilientFetch(new Request("https://example.test/x"))).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("gives up after the attempt budget and rethrows", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error("Connection terminated unexpectedly");
    }) as typeof fetch;
    await expect(resilientFetch(new Request("https://example.test/x"))).rejects.toThrow(
      /Connection terminated/
    );
    expect(calls).toBe(3);
  });

  it("times out a hung request instead of hanging the whole cron run", async () => {
    // The production symptom: the request never settles. Reproduced by never
    // resolving. Mutation: drop Promise.race → this test times out at 5s.
    globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
    await expect(resilientFetch(new Request("https://example.test/x"))).rejects.toMatchObject({
      name: "TimeoutError",
    });
  }, 30_000);

  it("calls the GLOBAL fetch, not this module's exported handler", async () => {
    // Regression guard for a real bug caught while writing this fix: the module
    // exports its own `fetch` Worker handler at the bottom, which shadows the
    // global inside the file. A bare `fetch(...)` inside resilientFetch resolved
    // to that handler — which calls runReminder — i.e. recursion on every Neon
    // query. Verified by mutation: reverting `globalThis.fetch` to a bare
    // `fetch(` fails 6 of the 12 tests in this file.
    let sawGlobal = false;
    globalThis.fetch = (async (input: Request) => {
      sawGlobal = true;
      expect(input).toBeInstanceOf(Request);
      return ok();
    }) as typeof fetch;
    await resilientFetch(new Request("https://example.test/neon"));
    expect(sawGlobal).toBe(true);
  });
});
