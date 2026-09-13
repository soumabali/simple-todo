import { describe, it, expect } from "vitest";
import { computeReminders, applyQuietHours } from "@/lib/reminders";
import type { NotificationSettings, TaskSchedule } from "@/lib/reminders";

// All expected times below are verified against Asia/Makassar (UTC+8),
// where 08:00 local == 00:00 UTC.

const TZ = "Asia/Makassar";

const settings: NotificationSettings = {
  pushEnabled: true,
  defaultTime: "08:00",
  leadMinutesStart: 0,
  leadMinutesDue: 1440, // one day
  notifyDueToday: true,
  notifyOverdue: true,
  quietStart: "22:00",
  quietEnd: "07:00",
};

function schedule(overrides: Partial<TaskSchedule> = {}): TaskSchedule {
  return {
    startDate: null,
    dueDate: null,
    dueTime: null,
    remindOnStart: true,
    remindLeadMinutes: null,
    remindersMuted: false,
    completedAt: null,
    ...overrides,
  };
}

// A fixed "now" well before the task dates so nothing is filtered as past.
const NOW = new Date("2026-09-01T00:00:00Z");

// TZDate.toISOString() renders the timezone offset (e.g. "+08:00"), so
// normalise to UTC via the epoch instant for timezone-agnostic assertions.
function utc(t: Date): string {
  return new Date(t.getTime()).toISOString();
}

describe("computeReminders (PRD §6.3)", () => {
  it("schedules all four kinds for a task with start + due", () => {
    const out = computeReminders(
      schedule({ startDate: "2026-09-15", dueDate: "2026-09-18" }),
      settings,
      TZ,
      NOW
    );
    const map = Object.fromEntries(out.map((r) => [r.kind, utc(r.scheduledFor)]));

    expect(map.start_soon).toBe("2026-09-15T00:00:00.000Z"); // start day 08:00 local, 0 lead
    expect(map.due_soon).toBe("2026-09-17T00:00:00.000Z"); // due day 08:00 - 1 day
    expect(map.due_today).toBe("2026-09-18T00:00:00.000Z"); // due day 08:00
    expect(map.overdue).toBe("2026-09-19T00:00:00.000Z"); // next day 08:00
    expect(out).toHaveLength(4);
  });

  it("respects a custom due_time", () => {
    const out = computeReminders(
      schedule({ startDate: null, dueDate: "2026-09-18", dueTime: "15:30" }),
      settings,
      TZ,
      NOW
    );
    const dueSoon = out.find((r) => r.kind === "due_soon")!;
    // 15:30 local - 1 day lead = 2026-09-17T07:30:00Z
    expect(utc(dueSoon.scheduledFor)).toBe("2026-09-17T07:30:00.000Z");
  });

  it("omits start_soon when remindOnStart is false", () => {
    const out = computeReminders(
      schedule({ startDate: "2026-09-15", dueDate: "2026-09-18", remindOnStart: false }),
      settings,
      TZ,
      NOW
    );
    expect(out.find((r) => r.kind === "start_soon")).toBeUndefined();
    expect(out).toHaveLength(3);
  });

  it("produces no reminders for a completed task", () => {
    const out = computeReminders(
      schedule({ startDate: "2026-09-15", dueDate: "2026-09-18", completedAt: new Date() }),
      settings,
      TZ,
      NOW
    );
    expect(out).toHaveLength(0);
  });

  it("produces no reminders when muted", () => {
    const out = computeReminders(
      schedule({ startDate: "2026-09-15", dueDate: "2026-09-18", remindersMuted: true }),
      settings,
      TZ,
      NOW
    );
    expect(out).toHaveLength(0);
  });

  it("produces no reminders when push is disabled", () => {
    const out = computeReminders(
      schedule({ startDate: "2026-09-15", dueDate: "2026-09-18" }),
      { ...settings, pushEnabled: false },
      TZ,
      NOW
    );
    expect(out).toHaveLength(0);
  });

  it("filters reminders already in the past", () => {
    // now is after the due date → everything is past.
    const out = computeReminders(
      schedule({ startDate: "2026-09-15", dueDate: "2026-09-18" }),
      settings,
      TZ,
      new Date("2026-09-20T00:00:00Z")
    );
    expect(out).toHaveLength(0);
  });
});

describe("applyQuietHours (PRD §6.3)", () => {
  const quietSettings: NotificationSettings = {
    ...settings,
    quietStart: "22:00",
    quietEnd: "07:00",
  };

  it("shifts a delivery inside quiet hours to quiet_end", () => {
    // 23:00 local = 15:00 UTC, inside 22:00–07:00 → shift to 07:00 next day.
    const t = new Date("2026-09-15T15:00:00Z"); // 23:00 Asia/Makassar
    const out = applyQuietHours(t, quietSettings, TZ);
    // quiet_end 07:00 next day local = 2026-09-15T23:00:00Z
    expect(utc(out)).toBe("2026-09-15T23:00:00.000Z");
  });

  it("leaves a delivery outside quiet hours unchanged", () => {
    const t = new Date("2026-09-15T00:00:00Z"); // 08:00 local
    const out = applyQuietHours(t, quietSettings, TZ);
    expect(utc(out)).toBe("2026-09-15T00:00:00.000Z");
  });
});
