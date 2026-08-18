import { describe, it, expect, vi, beforeEach } from "vitest";

const dnsLookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({ default: { lookup: (...a: unknown[]) => dnsLookupMock(...a) } }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { validateExternalAssetUrl } = await import("./asset-url-security");

function okHead() {
  return { status: 200, headers: new Headers() } as Response;
}
function redirectHead(location: string) {
  const headers = new Headers();
  headers.set("location", location);
  return { status: 302, headers } as Response;
}

beforeEach(() => {
  dnsLookupMock.mockReset();
  fetchMock.mockReset();
});

describe("validateExternalAssetUrl", () => {
  it("allows a Pexels URL that resolves to a public address", async () => {
    dnsLookupMock.mockResolvedValue([{ address: "151.101.1.1" }]); // real-shaped public IP
    fetchMock.mockResolvedValue(okHead());

    const url = "https://images.pexels.com/photos/12345/photo.jpeg";
    await expect(validateExternalAssetUrl(url)).resolves.toBe(url);
    expect(fetchMock).toHaveBeenCalledWith(url, { method: "HEAD", redirect: "manual" });
  });

  it("allows a subdomain of an allowed host but not a lookalike domain", async () => {
    dnsLookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
    fetchMock.mockResolvedValue(okHead());
    await expect(validateExternalAssetUrl("https://videos.pexels.com/clip.mp4")).resolves.toBe(
      "https://videos.pexels.com/clip.mp4"
    );

    await expect(validateExternalAssetUrl("https://pexels.com.attacker.example/x")).rejects.toThrow(/not in the allowlist/);
    await expect(validateExternalAssetUrl("https://notpexels.com/x")).rejects.toThrow(/not in the allowlist/);
  });

  it("rejects a host not in the allowlist even if it's a legitimate, unrelated public site", async () => {
    await expect(validateExternalAssetUrl("https://example.com/video.mp4")).rejects.toThrow(/not in the allowlist/);
    expect(dnsLookupMock).not.toHaveBeenCalled();
  });

  it("rejects non-http(s) protocols", async () => {
    await expect(validateExternalAssetUrl("file:///etc/passwd")).rejects.toThrow(/protocol/);
    await expect(validateExternalAssetUrl("ftp://pexels.com/x")).rejects.toThrow(/protocol/);
  });

  it("rejects malformed URLs", async () => {
    await expect(validateExternalAssetUrl("not a url at all")).rejects.toThrow(/Malformed/);
  });

  it("rejects localhost outright, without a DNS lookup", async () => {
    await expect(validateExternalAssetUrl("https://localhost/x")).rejects.toThrow(/localhost/);
  });

  describe("SSRF targets", () => {
    const cases: Array<[string, string]> = [
      ["loopback", "127.0.0.1"],
      ["loopback high range", "127.255.255.254"],
      ["private RFC1918 10/8", "10.1.2.3"],
      ["private RFC1918 172.16/12", "172.16.5.5"],
      ["private RFC1918 192.168/16", "192.168.1.1"],
      ["link-local incl. cloud metadata", "169.254.169.254"],
      ["carrier-grade NAT", "100.64.0.1"],
      ["unspecified", "0.0.0.0"],
      ["IPv6 loopback", "::1"],
      ["IPv6 link-local", "fe80::1"],
      ["IPv6 unique-local", "fd00::1"],
      ["IPv4-mapped IPv6 smuggling a private target", "::ffff:127.0.0.1"],
    ];

    for (const [label, ip] of cases) {
      it(`blocks an allowlisted host that resolves to ${label} (${ip})`, async () => {
        dnsLookupMock.mockResolvedValue([{ address: ip }]);
        await expect(validateExternalAssetUrl("https://images.pexels.com/x.jpg")).rejects.toThrow(/Blocked asset host/);
        expect(fetchMock).not.toHaveBeenCalled();
      });
    }

    it("blocks if ANY resolved address is unsafe, even when others are public (multi-A-record DNS rebinding shape)", async () => {
      dnsLookupMock.mockResolvedValue([{ address: "151.101.1.1" }, { address: "169.254.169.254" }]);
      await expect(validateExternalAssetUrl("https://images.pexels.com/x.jpg")).rejects.toThrow(/Blocked asset host/);
    });
  });

  describe("redirect revalidation", () => {
    it("follows a redirect to another allowed, public host and returns the final URL", async () => {
      dnsLookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
      fetchMock
        .mockResolvedValueOnce(redirectHead("https://videos.pexels.com/final.mp4"))
        .mockResolvedValueOnce(okHead());

      await expect(validateExternalAssetUrl("https://images.pexels.com/redirect")).resolves.toBe(
        "https://videos.pexels.com/final.mp4"
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("rejects a redirect chain that ultimately points at a private address", async () => {
      dnsLookupMock
        .mockResolvedValueOnce([{ address: "151.101.1.1" }]) // first hop looks fine
        .mockResolvedValueOnce([{ address: "169.254.169.254" }]); // redirect target does not
      fetchMock.mockResolvedValueOnce(redirectHead("https://images.pexels.com/internal-lookalike"));

      await expect(validateExternalAssetUrl("https://images.pexels.com/redirect")).rejects.toThrow(/Blocked asset host/);
    });

    it("rejects a redirect to a host outside the allowlist entirely", async () => {
      dnsLookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
      fetchMock.mockResolvedValueOnce(redirectHead("https://attacker.example/steal"));

      await expect(validateExternalAssetUrl("https://images.pexels.com/redirect")).rejects.toThrow(/not in the allowlist/);
    });

    it("rejects a redirect with no Location header", async () => {
      dnsLookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
      fetchMock.mockResolvedValueOnce({ status: 302, headers: new Headers() } as Response);

      await expect(validateExternalAssetUrl("https://images.pexels.com/redirect")).rejects.toThrow(/no Location header/);
    });

    it("gives up after too many redirect hops rather than following forever", async () => {
      dnsLookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
      fetchMock.mockResolvedValue(redirectHead("https://images.pexels.com/loop"));

      await expect(validateExternalAssetUrl("https://images.pexels.com/loop")).rejects.toThrow(/Too many redirects/);
    });
  });

  it("rejects when DNS resolution fails", async () => {
    dnsLookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(validateExternalAssetUrl("https://images.pexels.com/x.jpg")).rejects.toThrow(/Could not resolve/);
  });
});
