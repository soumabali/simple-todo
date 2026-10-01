import { describe, expect, it } from "vitest";
import {
  buildCsp,
  buildSecurityHeaders,
  frameAncestorsValue,
  parseAncestors,
} from "@/lib/security-headers";

/**
 * These tests exist because "let the board be embedded" is one env var away
 * from "let anyone frame the board and overlay it with fake admin UI"
 * (clickjacking). The default must stay closed, the open case must be named,
 * and the values that would silently undo it must be refused rather than
 * sanitized.
 *
 * Each test pins a behaviour a mutation would break; the mutation is named in
 * a comment.
 */

describe("parseAncestors", () => {
  it("returns nothing when unset, so the default is non-embeddable", () => {
    // Mutation: return ["*"] here → every deployment becomes frameable and the
    // X-Frame-Options fallback disappears.
    expect(parseAncestors(undefined)).toEqual([]);
    expect(parseAncestors("")).toEqual([]);
    expect(parseAncestors("   ")).toEqual([]);
  });

  it("refuses a wildcard instead of quietly allowing every site", () => {
    // Mutation: treat "*" as a pass-through → the CSP becomes
    // `frame-ancestors *`, i.e. exactly the clickjacking hole this closes.
    for (const bad of ["*", "https:", "http:", "https://*", "http://*"]) {
      expect(() => parseAncestors(bad)).toThrow(/wildcard|refusing/i);
    }
  });

  it("refuses a wildcard even when mixed with valid origins", () => {
    // Mutation: only validate the first entry → a trailing "*" slips through.
    expect(() => parseAncestors("https://ok.example.com, *")).toThrow();
  });

  it("refuses entries that are not origins", () => {
    // Mutation: pass values through unchecked → CSP parses to an empty source
    // list, browsers ignore the directive, and the behaviour depends on
    // browser fallback instead of our decision.
    for (const bad of ["dashboard.example.com", "https://a.example.com/path", "javascript:alert(1)"]) {
      expect(() => parseAncestors(bad)).toThrow(/not an origin/i);
    }
  });

  it("accepts explicit origins, normalising case and trailing slash", () => {
    expect(parseAncestors("HTTPS://Dash.Example.com/")).toEqual(["https://dash.example.com"]);
    expect(parseAncestors("http://localhost:3000")).toEqual(["http://localhost:3000"]);
    // Ports are significant and must survive.
    expect(parseAncestors("https://a.example.com:8443")).toEqual(["https://a.example.com:8443"]);
  });

  it("de-duplicates repeated origins", () => {
    // Mutation: drop the includes() check → the same origin appears twice in
    // the CSP. Harmless to browsers, but the header becomes a poor audit trail.
    expect(parseAncestors("https://a.example.com, https://A.example.com")).toEqual([
      "https://a.example.com",
    ]);
  });

  it("treats 'none' as the same state as unset", () => {
    expect(parseAncestors("'none'")).toEqual([]);
    expect(parseAncestors("none")).toEqual([]);
  });
});

describe("frameAncestorsValue", () => {
  it("falls back to 'none' rather than an empty directive", () => {
    // Mutation: return "" → the header reads `frame-ancestors ` and the
    // browser ignores it, so the embedding policy becomes browser-defined.
    expect(frameAncestorsValue([])).toBe("'none'");
  });

  it("lists the configured origins", () => {
    expect(frameAncestorsValue(["https://a.example.com", "https://b.example.com"])).toBe(
      "https://a.example.com https://b.example.com"
    );
  });
});

describe("buildSecurityHeaders", () => {
  it("ships X-Frame-Options: DENY while embedding is off", () => {
    const headers = buildSecurityHeaders([]);
    expect(headers).toContainEqual({ key: "X-Frame-Options", value: "DENY" });
    expect(buildCsp([])).toContain("frame-ancestors 'none'");
  });

  it("drops X-Frame-Options when an allowlist is configured", () => {
    // Mutation: keep XFO alongside the allowlist → DENY wins in every browser
    // and the feature simply does not work, while the CSP claims otherwise.
    const headers = buildSecurityHeaders(["https://dash.example.com"]);
    expect(headers.some((h) => h.key === "X-Frame-Options")).toBe(false);
    expect(buildCsp(["https://dash.example.com"])).toContain(
      "frame-ancestors https://dash.example.com"
    );
  });

  it("never emits a wildcard frame-ancestors", () => {
    // The end-to-end guard: whatever the input, the emitted policy must not be
    // a wildcard.
    for (const input of [undefined, "", "'none'", "https://a.example.com"]) {
      const csp = buildCsp(parseAncestors(input));
      expect(csp).not.toMatch(/frame-ancestors\s+\*/);
      expect(csp).toMatch(/frame-ancestors\s+('none'|https?:\/\/)/);
    }
  });

  it("keeps the unrelated hardening headers in both modes", () => {
    for (const origins of [[], ["https://dash.example.com"]]) {
      const headers = buildSecurityHeaders(origins);
      expect(headers).toContainEqual({ key: "X-Content-Type-Options", value: "nosniff" });
      expect(headers).toContainEqual({
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      });
    }
  });
});
