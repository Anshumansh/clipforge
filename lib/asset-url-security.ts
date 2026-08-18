import dns from "node:dns/promises";
import net from "node:net";

/**
 * Validates a URL that's about to be handed to Remotion for a server-side
 * fetch (b-roll from Pexels, etc.) -- everything the render process reads is
 * either our own presigned-and-ownership-checked media (a separate path, see
 * remotion-render.ts's resolveInternalMediaUrls) or one of these explicitly
 * allowed providers. Anything else is rejected outright: Remotion's renderer
 * runs a local proxy (see lib/remotion-render.ts's comment on the /proxy?src=
 * requests observed in worker logs) that does a real server-side fetch of
 * whatever URL a composition passes it -- an unvalidated URL there is a
 * textbook SSRF primitive (cloud metadata endpoints, internal services,
 * localhost-bound admin ports), not merely a broken asset.
 */

// Exact hosts or "ends with" suffixes (for subdomains) this process is willing
// to have Remotion fetch server-side. Keep this list to providers actually
// wired into a render pipeline today -- extend it deliberately, not by
// loosening the match, when a new provider is added.
const ALLOWED_ASSET_HOST_SUFFIXES = [
  "pexels.com", // lib/providers/broll.ts -- b-roll video/image CDN links
];

function isAllowedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return ALLOWED_ASSET_HOST_SUFFIXES.some((suffix) => lower === suffix || lower.endsWith(`.${suffix}`));
}

// IPv4 ranges covering loopback, private (RFC1918 + CGNAT), link-local
// (including the 169.254.169.254 cloud metadata endpoint every major
// provider uses), and other non-public reserved space. Expressed as
// [network, prefixLength] and checked with real integer math, not string
// prefix matching (which "10.0.0.0/8" as a literal string prefix would get
// subtly wrong for e.g. "10.255.255.255").
const IPV4_BLOCKED_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, includes the 169.254.169.254 metadata endpoint
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isBlockedIPv4(ip: string): boolean {
  const target = ipv4ToInt(ip);
  return IPV4_BLOCKED_RANGES.some(([network, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (target & mask) === (ipv4ToInt(network) & mask);
  });
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower === "::") return true; // unspecified
  if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique local fc00::/7
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) -- unwrap and re-check as IPv4 rather
  // than letting an attacker smuggle a blocked IPv4 target through the v6 form.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  return false;
}

function isBlockedIp(ip: string): boolean {
  return net.isIPv4(ip) ? isBlockedIPv4(ip) : net.isIPv6(ip) ? isBlockedIPv6(ip) : true; // unrecognized shape -- fail closed
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (hostname === "localhost") throw new Error(`Blocked asset host (localhost): ${hostname}`);

  let records: { address: string }[];
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new Error(`Could not resolve asset host: ${hostname} (${err instanceof Error ? err.message : String(err)})`);
  }
  if (records.length === 0) throw new Error(`Asset host resolved to no addresses: ${hostname}`);

  for (const { address } of records) {
    if (isBlockedIp(address)) {
      throw new Error(`Blocked asset host (resolves to a non-public address): ${hostname} -> ${address}`);
    }
  }
}

const MAX_REDIRECTS = 5;

/**
 * Validates an external (non-Clipforge) asset URL before it's allowed into
 * render props, and follows/revalidates redirects itself -- an allowed host's
 * DNS record or redirect target could point at a private address just as
 * easily as an attacker-supplied one, so "the starting URL was fine" isn't
 * sufficient; every hop has to resolve to a public address too. Returns the
 * final URL to actually use (after following any safe redirects); throws on
 * anything unsafe or unrecognized, which surfaces as a normal job failure
 * with a clear reason rather than a silently-passed-through URL.
 */
export async function validateExternalAssetUrl(rawUrl: string): Promise<string> {
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new Error(`Malformed asset URL: ${current}`);
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`Blocked asset URL protocol (${parsed.protocol}): ${current}`);
    }
    if (!isAllowedHost(parsed.hostname)) {
      throw new Error(`Asset host not in the allowlist: ${parsed.hostname}`);
    }
    await assertPublicHost(parsed.hostname);

    if (hop === MAX_REDIRECTS) {
      throw new Error(`Too many redirects resolving asset URL: ${rawUrl}`);
    }

    const res = await fetch(current, { method: "HEAD", redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`Redirect with no Location header for asset URL: ${current}`);
      current = new URL(location, current).toString();
      continue;
    }

    // Not a redirect -- this is the real asset. (HEAD failing outright, e.g.
    // a provider that doesn't support it, still proves the host/hop chain
    // was safe; the actual GET is Remotion's job, not this validator's.)
    return current;
  }

  throw new Error(`Too many redirects resolving asset URL: ${rawUrl}`);
}
