import { describe, it, expect } from "vitest";
import { assertDate, daysUntil, parseLimit, todayIn } from "@/lib/api-v1";

describe("daysUntil", () => {
  it("returns null when the task has no due date", () => {
    expect(daysUntil(null, "2026-09-20")).toBeNull();
  });

  it("counts calendar days in both directions", () => {
    expect(daysUntil("2026-09-20", "2026-09-20")).toBe(0);
    expect(daysUntil("2026-09-25", "2026-09-20")).toBe(5);
    expect(daysUntil("2026-09-17", "2026-09-20")).toBe(-3);
  });

  it("crosses month and year boundaries", () => {
    expect(daysUntil("2026-10-01", "2026-09-30")).toBe(1);
    expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1);
  });
});

describe("todayIn", () => {
  it("formats the date in the user's timezone", () => {
    // 2026-09-19T17:00Z is already the 20th in WITA (UTC+8).
    const at = new Date("2026-09-19T17:00:00Z");
    expect(todayIn("Asia/Makassar", at)).toBe("2026-09-20");
    expect(todayIn("UTC", at)).toBe("2026-09-19");
  });

  it("falls back to UTC for an unusable timezone instead of throwing", () => {
    const at = new Date("2026-09-19T17:00:00Z");
    expect(todayIn("Not/AZone", at)).toBe("2026-09-19");
  });
});

describe("parseLimit", () => {
  it("uses the fallback for missing or unusable input", () => {
    expect(parseLimit(null)).toBe(100);
    expect(parseLimit("abc")).toBe(100);
    expect(parseLimit("0")).toBe(100);
    expect(parseLimit("-5")).toBe(100);
  });

  it("clamps to the maximum", () => {
    expect(parseLimit("1000")).toBe(500);
    expect(parseLimit("1000", 100, 50)).toBe(50);
  });

  it("honours an explicit valid limit", () => {
    expect(parseLimit("25")).toBe(25);
  });
});

describe("assertDate", () => {
  it("accepts a strict YYYY-MM-DD string", () => {
    expect(assertDate("2026-09-20", "dueDate")).toBe("2026-09-20");
  });

  it("treats null/undefined/empty as 'not provided'", () => {
    expect(assertDate(null, "dueDate")).toBeNull();
    expect(assertDate(undefined, "dueDate")).toBeNull();
    expect(assertDate("", "dueDate")).toBeNull();
  });

  it("rejects non-ISO formats and impossible dates", () => {
    expect(() => assertDate("20-09-2026", "dueDate")).toThrow(/YYYY-MM-DD/);
    expect(() => assertDate("2026-9-2", "dueDate")).toThrow(/YYYY-MM-DD/);
    expect(() => assertDate(20260920, "dueDate")).toThrow(/YYYY-MM-DD/);
    // Well-formed but impossible calendar dates must also be refused.
    expect(() => assertDate("2026-13-01", "dueDate")).toThrow();
    expect(() => assertDate("2026-02-30", "dueDate")).toThrow();
    expect(() => assertDate("2027-02-29", "dueDate")).toThrow();
    // A real leap day is still accepted.
    expect(assertDate("2028-02-29", "dueDate")).toBe("2028-02-29");
  });
});
