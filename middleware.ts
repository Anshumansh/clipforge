import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Paths that must stay reachable without staging basic-auth: health checks
// (so Railway's own healthcheck probe never has to know a password),
// Stripe's webhook (authenticates via signature, not a browser session --
// Stripe's servers can't complete an HTTP Basic Auth challenge), and the
// metrics endpoint (already gated by its own bearer-token auth).
const STAGING_AUTH_EXEMPT_PREFIXES = ["/api/health", "/api/stripe/webhook", "/api/internal/metrics"];

function isStagingAuthExempt(pathname: string): boolean {
  return STAGING_AUTH_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p));
}

function unauthorizedResponse(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Staging"' },
  });
}

/** Staging-only site-wide protection: HTTP Basic Auth (so an unrestricted
 * demo/staging deployment isn't reachable by anyone who finds the URL) plus
 * X-Robots-Tag so search engines never index it. Gated entirely behind
 * STAGING_ENVIRONMENT so this has zero effect on production. */
function checkStagingProtection(req: NextRequest): NextResponse | null {
  if (process.env.STAGING_ENVIRONMENT !== "true") return null;
  if (isStagingAuthExempt(req.nextUrl.pathname)) return null;

  const user = process.env.STAGING_BASIC_AUTH_USER;
  const pass = process.env.STAGING_BASIC_AUTH_PASSWORD;
  // Fail closed: if staging is flagged but credentials aren't configured,
  // block rather than silently leaving the site open.
  if (!user || !pass) return unauthorizedResponse();

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Basic ")) return unauthorizedResponse();

  const decoded = Buffer.from(authHeader.slice("Basic ".length), "base64").toString("utf-8");
  const sepIndex = decoded.indexOf(":");
  const suppliedUser = sepIndex === -1 ? decoded : decoded.slice(0, sepIndex);
  const suppliedPass = sepIndex === -1 ? "" : decoded.slice(sepIndex + 1);

  if (suppliedUser !== user || suppliedPass !== pass) return unauthorizedResponse();

  return null; // authenticated, continue
}

export default async function middleware(req: NextRequest) {
  const stagingBlock = checkStagingProtection(req);
  if (stagingBlock) return stagingBlock;

  // Same authorization the previous `next-auth/middleware` default export
  // enforced for /dashboard/* -- reimplemented directly here since Next.js
  // only supports a single middleware chain and the staging gate above
  // needs to run on every path, not just /dashboard.
  if (req.nextUrl.pathname.startsWith("/dashboard")) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("callbackUrl", req.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  const res = NextResponse.next();
  if (process.env.STAGING_ENVIRONMENT === "true") {
    res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  return res;
}

export const config = {
  // Broadened from the previous /dashboard/:path* so the staging gate above
  // covers the whole site; excludes Next's own static asset paths, which
  // never need auth or a noindex header and would just add latency.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
