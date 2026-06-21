import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Server-side SSRF-safe URL validation and liveness checking.
//
// The verification engine resolves Google Search grounding redirects to their
// real publisher URLs and HEAD-checks the survivors. Because resolving a
// redirect means following URLs the model/search returned, every hop must be
// validated before it is fetched: http/https only, no private / loopback /
// link-local / reserved addresses (incl. cloud metadata 169.254.169.254).

const REQUEST_TIMEOUT_MS = 4000; // per HEAD request (per redirect hop)
const TOTAL_BUDGET_MS = 8000; // overall deadline across an entire redirect chain
const MAX_REDIRECTS = 5;
export const MAX_CONCURRENCY = 5;

/** True if an IP literal falls in a private, loopback, link-local or otherwise non-public range. */
export function isDisallowedIp(ip: string): boolean {
  const version = isIP(ip);

  if (version === 4) {
    const parts = ip.split(".").map(Number);
    if (
      parts.length !== 4 ||
      parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)
    )
      return true;
    const [a, b, c] = parts;
    if (a === 0) return true; // "this" network
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking (RFC 2544)
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC 6598)
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  if (version === 6) {
    const addr = ip.toLowerCase();

    // Re-check any embedded IPv4 (IPv4-mapped ::ffff:x, NAT64 64:ff9b::x, 6to4
    // 2002:x) as IPv4. `new URL()` canonicalizes these to hex (e.g.
    // ::ffff:127.0.0.1 -> ::ffff:7f00:1), so we must decode the hex form, not
    // just the dotted form — otherwise loopback/metadata slip through.
    const embedded = embeddedIpv4(addr);
    if (embedded) return isDisallowedIp(embedded);

    // Deny-by-default: only global-unicast 2000::/3 is treated as public.
    // This rejects loopback (::1), unspecified (::), link-local (fe80::/10),
    // unique-local (fc00::/7), and every other reserved/unknown range.
    const firstHextet = parseInt(addr.split(":")[0] || "", 16);
    if (Number.isNaN(firstHextet)) return true; // "::"-leading forms
    return !(firstHextet >= 0x2000 && firstHextet <= 0x3fff);
  }

  return true; // not a valid IP literal
}

/**
 * Returns the dotted IPv4 string embedded in an IPv4-mapped (::ffff:),
 * NAT64 (64:ff9b::) or 6to4 (2002:) IPv6 address — handling both the dotted
 * (::ffff:1.2.3.4) and the canonical hex (::ffff:7f00:1) spellings — or null.
 */
function embeddedIpv4(addr: string): string | null {
  const dotted = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);

  let hex: RegExpMatchArray | null = null;
  if (addr.startsWith("::ffff:")) {
    if (dotted) return dotted[1];
    hex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  } else if (addr.startsWith("64:ff9b::")) {
    if (dotted) return dotted[1];
    hex = addr.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  } else if (addr.startsWith("2002:")) {
    // 6to4 embeds the IPv4 in the second and third hextets.
    hex = addr.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})/);
  }

  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** True for hostnames that must never be fetched server-side regardless of DNS. */
function isDisallowedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  return false;
}

/**
 * Validates that a URL is a public http/https endpoint safe to fetch.
 * Resolves DNS and rejects if ANY resolved address is non-public.
 *
 * NOTE: this validates the IPs the hostname resolves to *now*; `fetch()` then
 * re-resolves independently, leaving a narrow DNS-rebinding TOCTOU window. The
 * residual risk is low here (HEAD only, no body returned, final host must still
 * match the Tier 1/2 allowlist to be cited) but is not fully closed. Closing it
 * requires pinning the validated IP via an undici dispatcher (`connect.lookup`),
 * which needs `undici` as a direct dependency — out of this change's scope.
 * Throws on any violation; returns the parsed URL otherwise.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("URL inválida");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Protocolo não permitido");
  }

  // Drop any credentials embedded in the URL (e.g. http://user:pass@host).
  url.username = "";
  url.password = "";

  const hostname = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (isDisallowedHostname(hostname)) throw new Error("Host não permitido");

  if (isIP(hostname)) {
    if (isDisallowedIp(hostname)) throw new Error("Endereço IP não permitido");
    return url;
  }

  const records = await lookup(hostname, { all: true });
  if (records.length === 0) throw new Error("Host não resolvido");
  for (const record of records) {
    if (isDisallowedIp(record.address))
      throw new Error("Host resolve para endereço privado");
  }
  return url;
}

export type LiveUrl = { url: string; hostname: string };

/**
 * Follows redirects manually (re-validating each hop for SSRF) with a short
 * per-request timeout AND an overall deadline across the whole chain, and
 * returns the final live URL + hostname, or null when the URL does not resolve
 * (404/410/5xx, DNS failure, timeout, too many hops). A slow redirect chain
 * cannot dominate the response. Never throws — a dead/unsafe link is dropped.
 */
export async function resolveLiveUrl(rawUrl: string): Promise<LiveUrl | null> {
  let current = rawUrl;
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null; // overall budget exhausted

    let safe: URL;
    try {
      safe = await assertPublicHttpUrl(current);
    } catch {
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(REQUEST_TIMEOUT_MS, remaining),
    );
    let res: Response;
    try {
      res = await fetch(safe.toString(), {
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "VerificakiBot/1.0 (+liveness-check)" },
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }

    const status = res.status;
    if (status >= 300 && status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;
      current = new URL(location, safe).toString();
      continue;
    }
    if (status >= 200 && status < 300) {
      return { url: safe.toString(), hostname: safe.hostname.toLowerCase() };
    }
    // Some hosts reject HEAD with 401/403/405 while still being live pages.
    if (status === 401 || status === 403 || status === 405) {
      return { url: safe.toString(), hostname: safe.hostname.toLowerCase() };
    }
    return null; // 404, 410, 5xx, etc.
  }

  return null; // too many redirects
}

/** Runs `fn` over `items` with a bounded number of concurrent workers, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
