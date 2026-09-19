import { buildPushHTTPRequest } from "@pushforge/builder";

/**
 * Web Push helpers (PRD §2.3 / §8.5).
 *
 * Uses @pushforge/builder — a zero-dependency, Web Crypto based library that
 * runs on Cloudflare Workers (workerd), unlike the Node `web-push` package.
 *
 * Key format:
 *  - VAPID_PUBLIC_KEY  : base64url string (safe to publish to the client)
 *  - VAPID_PRIVATE_KEY : the private key as a JWK JSON string (server secret)
 *
 * Generate once:  npx @pushforge/builder vapid
 * If these keys are ever rotated, every existing subscription dies (PRD §12.3).
 */

export type PushSubscriptionShape = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export function getVapidKeys(): { publicKey: string; privateKey: string; subject: string } {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@nexigo.my.id";

  if (!publicKey || !privateKey) {
    // Not configured yet — surface a clear error, never a fake key.
    throw new Error("VAPID keys are not configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)");
  }
  return { publicKey, privateKey, subject };
}

/** Send a push notification to a single subscription. Returns HTTP status. */
export async function sendPush(
  subscription: PushSubscriptionShape,
  payload: Record<string, string | number | boolean | null>,
  tag: string
): Promise<number> {
  const { privateKey, subject } = getVapidKeys();

  const request = await buildPushHTTPRequest({
    privateJWK: privateKey,
    subscription: {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    message: {
      payload: payload as any,
      adminContact: subject,
      options: { ttl: 3600, urgency: "normal", topic: tag },
    },
  });

  const res = await fetch(request.endpoint, {
    method: "POST",
    headers: request.headers as Headers,
    body: request.body,
  });

  return res.status;
}
