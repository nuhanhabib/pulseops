import { describe, expect, it } from "vitest";

import { createPinnedLookup, isPublicAddress, SsrfBlockedError, STRICT_SSRF_POLICY, validateTargetUrl } from "@/server/monitoring/ssrf";

const blocked = (url: string) => {
  try {
    validateTargetUrl(url, STRICT_SSRF_POLICY);
    return null;
  } catch (error) {
    return error instanceof SsrfBlockedError ? error.reason : "threw";
  }
};

describe("SSRF guard: URL policy", () => {
  it("accepts ordinary public URLs", () => {
    for (const url of ["https://example.com", "http://example.com/health?x=1", "https://api.example.com:8443/v1", "https://93.184.216.34/"]) {
      expect(blocked(url), url).toBeNull();
    }
  });

  it.each([
    ["ftp://example.com", "scheme"], ["file:///etc/passwd", "scheme"], ["gopher://example.com", "scheme"],
    ["https://user:pass@example.com", "credentials"], ["not a url", "invalid_url"],
  ])("rejects %s", (url, reason) => expect(blocked(url)).toBe(reason));

  it.each([
    "http://localhost", "http://localhost:3000", "http://app.localhost", "http://printer.local", "http://db.internal",
    "http://metadata.google.internal/computeMetadata/v1/", "http://intranet", "http://kubernetes.default.svc",
  ])("rejects internal hostname %s", (url) => expect(blocked(url)).toBe("hostname"));

  it.each([
    "http://127.0.0.1", "http://127.1", "http://10.0.0.5", "http://172.16.0.1", "http://192.168.1.1", "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1", "http://0.0.0.0", "http://[::1]", "http://[fd00:ec2::254]", "http://[fe80::1]", "http://[::ffff:127.0.0.1]", "http://[::ffff:10.0.0.1]",
  ])("rejects private or reserved address %s", (url) => expect(blocked(url)).toBe("private_address"));

  it("is not fooled by alternative IPv4 encodings of loopback", () => {
    // The URL parser canonicalizes these to 127.0.0.1 before the address check runs.
    for (const url of ["http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/", "http://0x7f.1/"]) {
      expect(blocked(url), url).toBe("private_address");
    }
  });

  it("rejects low service ports but allows web and high ports", () => {
    expect(blocked("http://example.com:22")).toBe("port");
    expect(blocked("http://example.com:25")).toBe("port");
    expect(blocked("http://example.com:80")).toBeNull();
    expect(blocked("https://example.com:443")).toBeNull();
    expect(blocked("http://example.com:8080")).toBeNull();
  });

  it("exempts only the exact host and port on the operator allowlist", () => {
    const policy = { allowedPrivateHosts: [{ host: "localhost", port: 4010 }] };
    expect(validateTargetUrl("http://localhost:4010/health", policy).exempt).toBe(true);
    expect(() => validateTargetUrl("http://localhost:5432/", policy)).toThrow(SsrfBlockedError);
    expect(() => validateTargetUrl("http://127.0.0.1:4010/", policy)).toThrow(SsrfBlockedError);
  });
});

describe("SSRF guard: address classification", () => {
  it("treats only global unicast addresses as public", () => {
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
    for (const address of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "192.168.0.1", "224.0.0.1", "255.255.255.255", "::", "::1", "fc00::1", "64:ff9b::a00:1", "garbage"]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });
});

describe("SSRF guard: pinned DNS lookup", () => {
  const target = validateTargetUrl("https://rebind.example.com/", STRICT_SSRF_POLICY);
  const resolverReturning = (addresses: { address: string; family: number }[]) =>
    ((_host: string, _options: unknown, callback: (error: Error | null, result: typeof addresses) => void) => callback(null, addresses)) as never;
  const lookup = (addresses: { address: string; family: number }[]) =>
    new Promise<{ error: Error | null; address: unknown }>((resolve) =>
      createPinnedLookup(target, resolverReturning(addresses))("rebind.example.com", { all: true }, (error, address) => resolve({ error, address })),
    );

  it("passes through vetted public addresses", async () => {
    const result = await lookup([{ address: "93.184.216.34", family: 4 }]);
    expect(result.error).toBeNull();
    expect(result.address).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("refuses a public hostname that resolves to a private address (DNS rebinding)", async () => {
    const result = await lookup([{ address: "169.254.169.254", family: 4 }]);
    expect(result.error).toBeInstanceOf(SsrfBlockedError);
  });

  it("refuses when any record is private, even if others are public", async () => {
    const result = await lookup([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.8", family: 4 }]);
    expect(result.error).toBeInstanceOf(SsrfBlockedError);
  });
});
