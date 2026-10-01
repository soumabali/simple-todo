/**
 * Embedding policy for FlowBoard's `frame-ancestors` directive.
 *
 * The app ships non-embeddable (`frame-ancestors 'none'` + `X-Frame-Options`):
 * a hostile page cannot put FlowBoard in an `<iframe>`, overlay its own UI, and
 * let a logged-in user click *our* admin controls while reading someone else's
 * text (clickjacking).
 *
 * Some deployments legitimately need the board framed elsewhere — a personal
 * dashboard, an internal wiki. That is supported, but it is opt-in and named:
 * nothing is allowed until `EMBED_ALLOWED_ANCESTORS` lists it.
 *
 * Two values are refused outright rather than merely discouraged, because each
 * one silently restores the exact attack the default prevents:
 *
 * - `*`  — every page on the web may frame the board.
 * - `https:` / `http:` — a scheme-wide wildcard, which is `*` with extra steps.
 *
 * Entries are validated as origins (`scheme://host[:port]`). An unparseable
 * value must fail loudly: if it were passed through, the directive would parse
 * to an empty source list and the browser would ignore it, so the deployment
 * would look configured while the frame behaviour depended on browser
 * fallback. Throwing at build time is the difference between "we decided" and
 * "we assumed".
 */

/** Values that would re-open the clickjacking hole. Refused, not sanitized. */
const FORBIDDEN = new Set(["*", "https:", "http:", "https://*", "http://*"]);

/** `'none'` / `none` is a legitimate way to write "nobody" — same as unset. */
const NONE = new Set(["'none'", "none", ""]);

/** `scheme://host[:port]`, optionally with a trailing slash. No paths, no wildcards. */
const ORIGIN = /^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i;

/**
 * A page opened straight from disk has no origin — it sends `Origin: null` and
 * its scheme is the literal `file:`. A wildcard does *not* cover it: measured
 * in Chrome, `frame-ancestors *` refuses a `file://` parent while
 * `frame-ancestors file:` admits it. So this is the only value that serves the
 * "embed in a local dashboard.html" case, and it is named rather than implied.
 *
 * It is accepted with a caveat worth stating: it means *any* HTML file on the
 * machine may frame FlowBoard. That is a far narrower set than `*` (every site
 * on the web), but it is not nothing — a downloaded file gets the same access.
 * Only list it if a local page is genuinely the intended embedder.
 */
const FILE_SCHEME = "file:";

/**
 * Parse `EMBED_ALLOWED_ANCESTORS` (comma-separated origins, optionally
 * scheme-qualified) into a list of origins.
 *
 * @throws if an entry is a wildcard, a bare scheme, or not an origin at all.
 */
export function parseAncestors(raw: string | undefined | null): string[] {
  if (!raw) return [];

  const origins: string[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim().replace(/\/+$/, "");
    if (NONE.has(value.toLowerCase())) continue;

    if (FORBIDDEN.has(value.toLowerCase())) {
      throw new Error(
        `EMBED_ALLOWED_ANCESTORS: refusing "${value}". A wildcard lets any site ` +
          `frame FlowBoard and overlay its own UI on our admin controls ` +
          `(clickjacking). List the specific origins that need to embed it.`
      );
    }

    if (!ORIGIN.test(value) && value.toLowerCase() !== FILE_SCHEME) {
      throw new Error(
        `EMBED_ALLOWED_ANCESTORS: "${value}" is not an origin. Expected ` +
          `scheme://host[:port] (e.g. https://dashboard.example.com), or the ` +
          `literal "file:" for a page opened from disk.`
      );
    }

    const origin = value.toLowerCase();
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

/**
 * The `frame-ancestors` source list. Falls back to `'none'` when nothing is
 * configured, so "no configuration" and "embeddable by nobody" are the same
 * state and a missing env var can never mean "open".
 */
export function frameAncestorsValue(origins: string[]): string {
  return origins.length > 0 ? origins.join(" ") : "'none'";
}

export function embedCookieAttributes(
  raw: string | undefined | null
) {
  const origins = parseAncestors(raw);
  if (origins.length === 0) return {};
  return {
    sameSite: "None" as const,
    secure: true,
    partitioned: true,
  };
}

/**
 * The full `Content-Security-Policy` value.
 *
 * Exported so tests can assert the directive without importing `next.config.ts`
 * (which carries Next types and a default export the runner would have to
 * execute).
 */
export function buildCsp(origins: string[]): string {
  return [
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
    `frame-ancestors ${frameAncestorsValue(origins)}`,
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Security headers as Next's `headers()` expects them.
 *
 * `X-Frame-Options` is emitted only while embedding is off. It cannot express a
 * list of origins, and `DENY`/`SAMEORIGIN` would override a permissive
 * `frame-ancestors` — so keeping it alongside an allowlist would either break
 * the feature or be dead weight. Where the allowlist applies, `frame-ancestors`
 * is the single source of truth.
 */
export function buildSecurityHeaders(origins: string[]) {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Content-Security-Policy", value: buildCsp(origins) },
  ];

  const embedsAllowed = origins.length > 0;
  if (!embedsAllowed) {
    headers.splice(2, 0, { key: "X-Frame-Options", value: "DENY" });
  }
  return headers;
}
