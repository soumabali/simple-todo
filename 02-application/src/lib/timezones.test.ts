import { describe, it, expect } from "vitest";
import { TIMEZONES } from "@/lib/timezones";

describe("TIMEZONES", () => {
  it("offers WITA, the app default, exactly once", () => {
    expect(TIMEZONES.filter((t) => t.value === "Asia/Makassar")).toHaveLength(1);
  });

  it("has no duplicate values", () => {
    const values = TIMEZONES.map((t) => t.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("lists only names Intl can format in", () => {
    // A bad entry would throw inside reminders.ts, so validate the whole list.
    for (const t of TIMEZONES) {
      expect(() =>
        new Intl.DateTimeFormat("en-US", { timeZone: t.value }).format(new Date())
      ).not.toThrow();
    }
  });

  it("includes UTC so a user can opt out of a local zone", () => {
    expect(TIMEZONES.some((t) => t.value === "UTC")).toBe(true);
  });
});
