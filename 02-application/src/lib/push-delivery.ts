/**
 * Pure delivery-decision helpers shared by the reminder cron Worker and its
 * unit tests (PRD §13 — "Cron: a 410 response deletes the subscription; a 500
 * triggers a retry").
 *
 * Kept free of runtime/database/fetch dependencies so the logic is testable
 * without a live Postgres or push service.
 */

/** Classification of a push-service HTTP response (PRD §M7). */
export type DeliveryOutcome = "success" | "dead" | "retry";

/**
 * Map a push-service HTTP status to the action to take against the
 * subscription / queue row.
 *  - 2xx            → success (reset failure counter)
 *  - 404 / 410      → dead subscription (delete it permanently)
 *  - 429 / 5xx      → transient failure (retry with backoff)
 */
export function classifyDeliveryStatus(status: number): DeliveryOutcome {
  if (status >= 200 && status < 300) return "success";
  if (status === 404 || status === 410) return "dead";
  if (status === 429 || status >= 500) return "retry";
  // Anything else is treated as a transient failure (retry), never a hard drop.
  return "retry";
}

/** Backoff schedule in minutes for successive delivery attempts: 5 / 20 / 60 (PRD §M7). */
const BACKOFF_MINUTES = [5, 20, 60];

export function backoffMinutes(attempts: number): number {
  // attempts is 1-based (already incremented); clamp into the schedule.
  return BACKOFF_MINUTES[Math.min(Math.max(attempts - 1, 0), BACKOFF_MINUTES.length - 1)];
}

/** Maximum retry attempts before a queue row is marked `failed` (PRD §M7). */
export const MAX_DELIVERY_ATTEMPTS = 3;

/** A subscription is deactivated once its consecutive failure count reaches this (PRD §M7). */
export const MAX_SUBSCRIPTION_FAILURES = 5;
