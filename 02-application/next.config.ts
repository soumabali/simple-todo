import type { NextConfig } from "next";

/**
 * Security headers (PRD §11).
 *
 * CSP is deliberately strict: no `unsafe-inline` for scripts. Styles use
 * `unsafe-inline` because Tailwind/Radix set inline style attributes at
 * runtime (color tokens, transforms) — removing it would break the UI.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // NOTE: Next.js App Router injects its React Server Component payload
      // and bootstrap via inline <script> tags. Without a nonce, `script-src`
      // MUST include 'unsafe-inline' or the browser blocks hydration and the
      // page renders blank white (BUG-6). A nonce-based CSP is the proper
      // hardening follow-up; 'unsafe-inline' is required for now.
      "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://fcm.googleapis.com https://updates.push.services.mozilla.com https://web.push.apple.com https://android.googleapis.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

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
