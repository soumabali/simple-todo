import { NextResponse, NextRequest } from "next/server";

/**
 * Edge-safe middleware — does NOT import better-auth (its Node `crypto` usage
 * is not supported on the Edge runtime).
 *
 * It only does a lightweight cookie-presence check and handles the forced
 * password-change / admin redirects are done in the server layout, which runs
 * on the Node runtime and can call auth.api.getSession().
 */

// better-auth prefixes the cookie with `__Secure-` when served over HTTPS.
// Local dev (HTTP) uses the un-prefixed name, production (HTTPS) uses the
// prefixed one. Check both so sessions work in every environment.
const SESSION_COOKIES = [
  "__Secure-better-auth.session_token",
  "better-auth.session_token",
];

const PUBLIC_PATHS = ["/login", "/api/auth", "/api/push/public-key"];

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Static assets / favicons / manifest / service worker.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/manifest") ||
    pathname === "/sw.js" ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".webmanifest")
  ) {
    return NextResponse.next();
  }

  const hasSession = SESSION_COOKIES.some((name) => req.cookies.has(name));

  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
