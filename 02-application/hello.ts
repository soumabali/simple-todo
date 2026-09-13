/**
 * Neon Function scaffold (PRD §2.7.4).
 *
 * This file MUST stay on disk while the `preview.functions.api` block exists
 * in neon.ts — a declared function with no file on disk fails `neon deploy`.
 *
 * We deliberately do NOT put application logic here: Neon Functions are still
 * in private preview and overlap with Cloudflare Workers. This stays an inert
 * placeholder until Neon Functions reaches GA (§2.7.4).
 */

export default async function handler() {
  return new Response("FlowBoard Neon Function scaffold (unused in v1)");
}
