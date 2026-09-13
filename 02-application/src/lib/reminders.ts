import { addMinutes, format, isBefore, setHours, setMinutes, startOfDay } from "date-fns";
import { TZDate } from "@date-fns/tz";

/**
 * Reminder scheduling (PRD §6.3 / §8.5).
 *
 * Four kinds, all computed in the user's stored timezone:
 *  - start_soon : start_date at default hour, minus leadMinutesStart
 *  - due_soon   : due_date (+ due_time when set) minus leadMinutesDue
 *  - due_today  : morning of due_date at default hour
 *  - overdue    : morning of the day after due_date, once only
 *
 * Pure functions so they can be unit-tested across timezones and quiet hours.
 */

export type ReminderKind = "start_soon" | "due_soon" | "due_today" | "overdue";

export type NotificationSettings = {
  pushEnabled: boolean;
  defaultTime: string; // "HH:mm"
  leadMinutesStart: number;
  leadMinutesDue: number;
  notifyDueToday: boolean;
  notifyOverdue: boolean;
  quietStart: string; // "HH:mm"
  quietEnd: string; // "HH:mm"
};

export type TaskSchedule = {
  startDate: string | null; // "YYYY-MM-DD"
  dueDate: string | null; // "YYYY-MM-DD"
  dueTime: string | null; // "HH:mm"
  remindOnStart: boolean;
  remindLeadMinutes: number | null;
  remindersMuted: boolean;
  completedAt: Date | null;
};

function parseTime(t: string): { h: number; m: number } {
  const [h, m] = t.split(":").map(Number);
  return { h, m };
}

/** Build a Date at a given local date string + time string, in the user's tz. */
function atLocalTime(dateStr: string, timeStr: string, timezone: string): Date {
  const { h, m } = parseTime(timeStr);
  const d = new TZDate(dateStr + "T00:00:00", timezone);
  return setMinutes(setHours(d, h), m);
}

/**
 * Shift a delivery time that falls inside quiet hours to the end of quiet
 * hours (quiet_end). Returns the possibly-adjusted Date.
 */
export function applyQuietHours(
  t: Date,
  settings: NotificationSettings,
  timezone: string
): Date {
  const { quietStart, quietEnd } = settings;
  const qs = parseTime(quietStart);
  const qe = parseTime(quietEnd);

  const start = atLocalTime(format(t, "yyyy-MM-dd"), quietStart, timezone);
  let end = atLocalTime(format(t, "yyyy-MM-dd"), quietEnd, timezone);
  // Quiet window crosses midnight (e.g. 22:00 → 07:00).
  if (qs.h > qe.h || (qs.h === qe.h && qs.m > qe.m)) {
    end = addMinutes(end, 24 * 60);
  }

  if (isBefore(t, end) && !isBefore(t, start)) {
    return end; // shift to quiet_end
  }
  return t;
}

export type ComputedReminder = {
  kind: ReminderKind;
  scheduledFor: Date;
};

/**
 * Compute every reminder that should be scheduled for a task, given the
 * user's notification settings and timezone. Returns an empty array when the
 * task is complete, muted, or has no dates.
 */
export function computeReminders(
  task: TaskSchedule,
  settings: NotificationSettings,
  timezone: string,
  now: Date = new Date()
): ComputedReminder[] {
  const out: ComputedReminder[] = [];

  if (task.completedAt || task.remindersMuted || !settings.pushEnabled) {
    return out;
  }

  const defaultTime = settings.defaultTime || "08:00";

  // start_soon
  if (task.startDate && task.remindOnStart) {
    const lead = task.remindLeadMinutes ?? settings.leadMinutesStart;
    let t = atLocalTime(task.startDate, defaultTime, timezone);
    t = addMinutes(t, -lead);
    t = applyQuietHours(t, settings, timezone);
    out.push({ kind: "start_soon", scheduledFor: t });
  }

  if (task.dueDate) {
    const dueTime = task.dueTime ?? defaultTime;

    // due_soon — lead time before the deadline
    const lead = task.remindLeadMinutes ?? settings.leadMinutesDue;
    let tSoon = atLocalTime(task.dueDate, dueTime, timezone);
    tSoon = addMinutes(tSoon, -lead);
    tSoon = applyQuietHours(tSoon, settings, timezone);
    out.push({ kind: "due_soon", scheduledFor: tSoon });

    // due_today — morning of the due date
    if (settings.notifyDueToday) {
      let tToday = atLocalTime(task.dueDate, defaultTime, timezone);
      tToday = applyQuietHours(tToday, settings, timezone);
      out.push({ kind: "due_today", scheduledFor: tToday });
    }

    // overdue — morning of the day after due date, once only
    if (settings.notifyOverdue) {
      const nextDay = addMinutes(startOfDay(new TZDate(task.dueDate + "T00:00:00", timezone)), 24 * 60);
      let tOver = atLocalTime(format(nextDay, "yyyy-MM-dd"), defaultTime, timezone);
      tOver = applyQuietHours(tOver, settings, timezone);
      out.push({ kind: "overdue", scheduledFor: tOver });
    }
  }

  // Never schedule a reminder in the past (already missed).
  return out.filter((r) => !isBefore(r.scheduledFor, now));
}
