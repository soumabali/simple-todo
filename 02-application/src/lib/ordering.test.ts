import { describe, it, expect } from "vitest";
import {
  EPSILON,
  REBALANCE_STEP,
  midpoint,
  needsRebalance,
  rebalancePositions,
} from "@/lib/ordering";

describe("ordering midpoint (PRD §6.2)", () => {
  it("returns the step when both neighbours are null", () => {
    expect(midpoint(null, null)).toBe(REBALANCE_STEP);
  });

  it("halves when only `next` is present", () => {
    expect(midpoint(null, 2000)).toBe(1000);
  });

  it("appends when only `prev` is present", () => {
    expect(midpoint(1000, null)).toBe(2000);
  });

  it("returns the average of prev and next", () => {
    expect(midpoint(1000, 2000)).toBe(1500);
  });
});

describe("rebalancing detection", () => {
  it("flags a gap below epsilon", () => {
    expect(needsRebalance(1000, 1000 + EPSILON / 2)).toBe(true);
  });

  it("does not flag a gap above epsilon", () => {
    expect(needsRebalance(1000, 1000 + EPSILON * 2)).toBe(false);
  });
});

describe("rebalancePositions", () => {
  it("produces evenly spaced positions", () => {
    expect(rebalancePositions(3)).toEqual([1000, 2000, 3000]);
    expect(rebalancePositions(0)).toEqual([]);
  });
});
