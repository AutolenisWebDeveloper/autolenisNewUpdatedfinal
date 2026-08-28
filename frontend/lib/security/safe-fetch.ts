// Allowlisted outbound fetch for dealer-supplied document URLs.
//
// POST /api/dealer/contracts/upload accepts `documentUrl: z.string().url()` from
// an authenticated dealer, and Contract Shield then fetched it directly. Any
// http(s) URL was accepted, so a dealer could drive server-side requests at
// internal addresses (cloud metadata, loopback, RFC1918) — server-side request
// forgery. This module is the single choke point that closes it.
//
// Defence is positive (an allowlist of hosts), not negative (a blocklist of
// payloads): the host must be the configured storage host, the scheme must be
// https, literal/private IPs are refused outright, and redirects are refused so
// a 302 cannot walk out of the allowlist.

// NOTE: no `import "server-only"` here. The only consumer,
// lib/services/contract-shield/extract-text.ts, already carries that guard, and
// this module holds no secrets — keeping it importable means the allowlist logic
// can be unit-tested directly, which is exactly what an SSRF guard needs.

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

const FETCH_TIMEOUT_MS = 10_000;

/** Hosts a contract document may be fetched from. */
export function allowedContractHosts(): string[] {
  const hosts: string[] = [];
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (supabaseUrl) {
    try {
      hosts.push(new URL(supabaseUrl).hostname.toLowerCase());
    } catch {
      /* malformed env — contributes no host, so nothing is allowed by accident */
    }
  }
  const extra = process.env.CONTRACT_FETCH_ALLOWED_HOSTS ?? "";
  for (const h of extra.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    hosts.push(h);
  }
  return hosts;
}

/** Reject anything that is an IP literal — public or private. Contracts live on a named host. */
function isIpLiteral(hostname: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true; // IPv4
  if (hostname.startsWith("[") || hostname.includes(":")) return true; // IPv6 literal
  return false;
}

/**
 * Validate a dealer-supplied contract URL. Returns the parsed URL or throws.
 * Exported separately from the fetch so it is directly unit-testable.
 */
export function assertAllowedContractUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError("Document URL is not a valid URL");
  }

  if (url.protocol !== "https:") {
    throw new BlockedUrlError(`Document URL must use https (got ${url.protocol})`);
  }

  const hostname = url.hostname.toLowerCase();

  // Loopback / link-local / private ranges, and any IP literal at all.
  if (
    isIpLiteral(hostname) ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".local")
  ) {
    throw new BlockedUrlError("Document URL host is not permitted");
  }

  const allowed = allowedContractHosts();
  if (allowed.length === 0) {
    // Fail CLOSED: with no configured storage host we cannot say a URL is safe.
    throw new BlockedUrlError("No allowed contract host is configured");
  }
  if (!allowed.includes(hostname)) {
    throw new BlockedUrlError("Document URL host is not permitted");
  }

  return url;
}

/**
 * Fetch a contract document from an allowlisted host.
 * `redirect: "error"` is load-bearing — without it an allowed host could 302 to
 * an internal address and reopen the hole this module exists to close.
 */
export async function fetchAllowedContract(rawUrl: string): Promise<Response> {
  const url = assertAllowedContractUrl(rawUrl);
  return fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}
