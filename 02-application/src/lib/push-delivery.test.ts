import { describe, it, expect } from "vitest";
import {
  classifyDeliveryStatus,
  backoffMinutes,
  MAX_DELIVERY_ATTEMPTS,
  MAX_SUBSCRIPTION_FAILURES,
} from "./push-delivery";

describe("classifyDeliveryStatus (PRD §M7 / §13 cron)", () => {
  it("treats 2xx as success", () => {
    for (const s of [200, 201, 204]) {
      expect(classifyDeliveryStatus(s)).toBe("success");
    }
  });

  it("treats 404/410 as a dead subscription (delete it)", () => {
    expect(classifyDeliveryStatus(404)).toBe("dead");
    expect(classifyDeliveryStatus(410)).toBe("dead");
  });

  it("treats 429/5xx as a transient retry", () => {
    for (const s of [429, 500, 502, 503, 504]) {
      expect(classifyDeliveryStatus(s)).toBe("retry");
    }
  });

  it("treats unknown statuses as retry (never a hard drop)", () => {
    expect(classifyDeliveryStatus(400)).toBe("retry");
    expect(classifyDeliveryStatus(301)).toBe("retry");
  });
});

describe("backoffMinutes (PRD §M7: 5 / 20 / 60 min)", () => {
  it("returns 5 for the first retry, 20 for the second, 60 for the third and beyond", () => {
    expect(backoffMinutes(1)).toBe(5);
    expect(backoffMinutes(2)).toBe(20);
    expect(backoffMinutes(3)).toBe(60);
    expect(backoffMinutes(4)).toBe(60);
    expect(backoffMinutes(99)).toBe(60);
  });
});

describe("delivery constants", () => {
  it("matches the PRD limits", () => {
    expect(MAX_DELIVERY_ATTEMPTS).toBe(3);
    expect(MAX_SUBSCRIPTION_FAILURES).toBe(5);
  });
});
