import type { NextConfig } from "next";
import { buildSecurityHeaders, parseAncestors } from "./src/lib/security-headers";

/**
 * Security headers (PRD §11).
 *
 * The CSP is strict: no `unsafe-inline` for scripts, no wildcard
 * `frame-ancestors`. Styles use `unsafe-inline` because Tailwind/Radix set
 * inline style attributes at runtime (color tokens, transforms) — removing it
 * would break the UI.
 *
 * Embedding is opt-in per origin. `parseAncestors` rejects `*` and bare
 * schemes, so listing `EMBED_ALLOWED_ANCESTORS` cannot silently re-open
 * clickjacking. Note this value is read at *build* time: OpenNext turns
 * `headers()` into a static route manifest, so changing it requires a rebuild,
 * not just a new Worker var.
 */
const securityHeaders = buildSecurityHeaders(
  parseAncestors(process.env.EMBED_ALLOWED_ANCESTORS)
);

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  // HSTS must be added at the edge (Cloudflare) where TLS terminates; it has
  // no effect on the origin. Set it via a Cloudflare Transform Rule or the
  // `_headers`/wrangler config, not here (PRD §11).
};

export default nextConfig;
