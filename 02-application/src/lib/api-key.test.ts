import { describe, it, expect } from "vitest";
import {
  API_KEY_PREFIX,
  extractApiKey,
  generateApiKey,
  isKeyActive,
  looksLikeApiKey,
  parseScopes,
  sha256Hex,
} from "@/lib/api-key";
import { daysUntil, parseLimit, assertDate } from "@/lib/api-v1";

describe("api key generation", () => {
  it("mints a 256-bit key with the expected shape", async () => {
    const { plaintext, prefix, keyHash } = await generateApiKey();
    expect(looksLikeApiKey(plaintext)).toBe(true);
    expect(plaintext.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(plaintext.length).toBe(API_KEY_PREFIX.length + 64);
    expect(prefix.length).toBe(API_KEY_PREFIX.length + 8);
    expect(plaintext.startsWith(prefix)).toBe(true);
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(keyHash).toBe(await sha256Hex(plaintext));
  });

  it("never repeats two keys", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const { plaintext } = await generateApiKey();
      expect(seen.has(plaintext)).toBe(false);
      seen.add(plaintext);
    }
  });

  it("rejects malformed keys before hitting the database", () => {
    expect(looksLikeApiKey("")).toBe(false);
    expect(looksLikeApiKey("fbk_short")).toBe(false);
    expect(looksLikeApiKey(`fbk_${"z".repeat(64)}`)).toBe(false); // non-hex
    expect(looksLikeApiKey(`fbk_${"a".repeat(63)}`)).toBe(false); // 1 char short
    expect(looksLikeApiKey(`xxx_${"a".repeat(64)}`)).toBe(false); // wrong prefix
    expect(looksLikeApiKey(`fbk_${"A".repeat(64)}`)).toBe(false); // uppercase
  });
});

describe("api key extraction", () => {
  it("reads a Bearer token", () => {
    const req = new Request("https://example.com/api/v1/todos", {
      headers: { authorization: "Bearer fbk_abc" },
    });
    expect(extractApiKey(req)).toBe("fbk_abc");
  });

  it("is case-insensitive on the scheme and tolerant of spaces", () => {
    const req = new Request("https://example.com/x", {
      headers: { authorization: "  bearer   fbk_abc  " },
    });
    expect(extractApiKey(req)).toBe("fbk_abc");
  });

  it("falls back to x-api-key", () => {
    const req = new Request("https://example.com/x", { headers: { "x-api-key": " fbk_abc " } });
    expect(extractApiKey(req)).toBe("fbk_abc");
  });

  it("prefers Authorization over x-api-key", () => {
    const req = new Request("https://example.com/x", {
      headers: { authorization: "Bearer fbk_auth", "x-api-key": "fbk_header" },
    });
    expect(extractApiKey(req)).toBe("fbk_auth");
  });

  it("returns null when no key is present", () => {
    expect(extractApiKey(new Request("https://example.com/x"))).toBeNull();
  });
});

describe("key activity / scopes", () => {
  it("treats a non-revoked, non-expired key as active", () => {
    expect(isKeyActive({ revokedAt: null, expiresAt: null })).toBe(true);
  });

  it("treats a revoked key as inactive", () => {
    expect(isKeyActive({ revokedAt: new Date(), expiresAt: null })).toBe(false);
  });

  it("treats an expired key as inactive but a future one as active", () => {
    expect(isKeyActive({ revokedAt: null, expiresAt: new Date(Date.now() - 1000) })).toBe(false);
    expect(isKeyActive({ revokedAt: null, expiresAt: new Date(Date.now() + 1000) })).toBe(true);
  });

  it("defaults and sanitises scopes", () => {
    expect(parseScopes(undefined)).toEqual(["read", "write"]);
    expect(parseScopes([])).toEqual(["read", "write"]);
    expect(parseScopes(["read"])).toEqual(["read"]);
    expect(parseScopes(["read", "read"])).toEqual(["read"]);
    expect(parseScopes(["bogus"])).toEqual(["read", "write"]);
    expect(parseScopes(["read", "bogus"])).toEqual(["read"]);
  });
});

describe("serialisation helpers", () => {
  it("computes days until due, negative when overdue", () => {
    expect(daysUntil("2026-09-19", "2026-09-19")).toBe(0);
    expect(daysUntil("2026-09-20", "2026-09-19")).toBe(1);
    expect(daysUntil("2026-09-17", "2026-09-19")).toBe(-2);
    expect(daysUntil(null, "2026-09-19")).toBeNull();
    expect(daysUntil("not-a-date", "2026-09-19")).toBeNull();
  });

  it("clamps limits", () => {
    expect(parseLimit(null)).toBe(100);
    expect(parseLimit("10")).toBe(10);
    expect(parseLimit("0")).toBe(100);
    expect(parseLimit("-5")).toBe(100);
    expect(parseLimit("abc")).toBe(100);
    expect(parseLimit("9999")).toBe(500);
  });

  it("validates date strings", () => {
    expect(assertDate("2026-09-19", "dueDate")).toBe("2026-09-19");
    expect(assertDate(null, "dueDate")).toBeNull();
    expect(assertDate("", "dueDate")).toBeNull();
    expect(() => assertDate("19-09-2026", "dueDate")).toThrow();
    expect(() => assertDate("2026-13-45", "dueDate")).toThrow();
  });
});
