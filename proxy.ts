import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Paths that must stay reachable without staging basic-auth: health checks
// (so Railway's own healthcheck probe never has to know a password),
// Stripe's webhook (authenticates via signature, not a browser session --
// Stripe's servers can't complete an HTTP Basic Auth challenge), the
// metrics endpoint (already gated by its own bearer-token auth), and the
// media proxy -- found failing live (Release Candidate Validation item 5,
// 2026-08-15): the worker's Remotion renderer fetches source audio/video
// through this route via a plain server-to-server HTTP request (no
// browser, no credentials to attach), and every render failed with
// "Received a status code of 401 ... Authentication required" once this
// route was covered by the blanket staging gate. The route itself already
// requires knowing an unguessable object key and redirects to a
// short-lived presigned URL, which is the same protection level
// production relies on with no basic-auth layer at all.
const STAGING_AUTH_EXEMPT_PREFIXES = [
  "/api/health",
  "/api/stripe/webhook",
  "/api/internal/metrics",
  "/api/media",
  "/api/showcase",
];

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

export async function proxy(req: NextRequest) {
  const stagingBlock = checkStagingProtection(req);
  if (stagingBlock) return stagingBlock;

  // Same authorization the previous `next-auth/middleware` default export
  // enforced for /dashboard/* -- reimplemented directly here since Next.js
  // only supports a single middleware chain and the staging gate above
  // needs to run on every path, not just /dashboard.
  if (req.nextUrl.pathname.startsWith("/dashboard")) {
    // next-auth v4's getToken may throw on malformed Bearer input. Treat
    // malformed tokens as unauthenticated so an attacker cannot turn one
    // bad header into an uncaught 500 on every protected page.
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET }).catch(() => null);
    if (!token) {
      // `req.url`/`new URL(path, req.url)` resolve using whatever origin
      // Next.js's edge runtime believes it is -- behind a reverse proxy
      // that doesn't forward a Host header matching the public hostname
      // (observed on Railway: resolves to the container's own bind
      // address, e.g. http://0.0.0.0:8080), that produces a redirect
      // target and callback value pointing at an address the browser can
      // never reach. NextResponse.redirect() below still lands on the
      // right host (Next.js resolves *that* URL's origin correctly), but
      // a value merely written into a query string does not get the same
      // treatment. Building the redirect from req.nextUrl (already
      // same-origin-correct) and passing only a relative path+query as
      // the callback value sidesteps host resolution entirely -- also
      // matches the param name (`next`) the login page itself reads,
      // which "callbackUrl" (NextAuth's own convention, but not this
      // page's) never did.
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      loginUrl.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
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
