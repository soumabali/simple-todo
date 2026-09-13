import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext adapter config (PRD §2.2 / §12.4).
 *
 * We stay on OpenNext (not `next-on-pages`, not `vinext`) for v1 because it
 * is the official Cloudflare path for full-stack Next.js and runs unmodified
 * App Router builds. The adapter produces `.open-next/worker.js` which the
 * web Worker's wrangler.jsonc points at.
 */
export default defineCloudflareConfig({
  // Incremental cache lives in the Worker, no KV/R2 needed in v1.
});
