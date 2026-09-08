// lib/services/acquisition/intake-attribution.ts
//
// §5 rule 2, and the shape it actually has to take in columns.
//
//   "Attribution is mandatory. utm_source, utm_medium, utm_campaign, utm_content,
//    source_url, referrer, landing_source, affiliate_id, and ip_address are written
//    on every submission. A submission with no attribution is recorded as `direct`,
//    never as null."
//
// READ THAT CAREFULLY, because it is the sentence that produced a live defect. The
// SUBMISSION is recorded as `direct`; the individual FIELDS are not. §8.2 Phase 2
// spells it out: "individual UTM fields nullable; canonical
// `acquisition_channel = 'direct'` when absent; `source_url`/`referrer` a valid URL
// or NULL; `affiliate_id` valid or NULL; `ip_address` server-captured OR NULL —
// NEVER A SENTINEL STRING — with the reason recorded in the separate controlled
// column `ip_unavailable_reason`."
//
// The distinction matters because §7.2 found the opposite failure in production:
// three Vehicle Requests with `utm_source`, `landing_source` and `ip_address` ALL
// NULL and no channel recorded at all — attribution was not written as `direct`,
// it simply was not written. And the Phase 1 migration guards the other direction
// with CHECK constraints: writing the literal "direct" or "unknown" into an address
// column is refused by the database, because a sentinel in an address column is a
// value that looks like data and is not.
//
// So: exactly one column carries "where did this come from" (`acquisition_channel`,
// never null, defaulting to `direct`), and every other column is either a real
// value or NULL. `ip_unavailable_reason` is the controlled vocabulary that says WHY
// an address is missing, so "we could not read it" and "we did not try" stay
// distinguishable.
//
// Run: pnpm test:intake

/** §8.2's controlled vocabulary for a missing IP. The migration CHECKs these five. */
export const IP_UNAVAILABLE_REASONS = [
  /** No forwarding header on the request — a direct or proxy-stripped call. */
  "PROXY_HEADER_ABSENT",
  /** Written by a cron, a webhook or a reconciler — there is no client to have an address. */
  "SERVER_SIDE_JOB",
  /** Deliberately dropped before storage under the retention policy. */
  "ANONYMIZED_BY_POLICY",
  /** The client suppressed it (Do-Not-Track, a privacy proxy). */
  "CLIENT_WITHHELD",
  /** None of the above applied and the capture still failed. */
  "UNKNOWN",
] as const;

export type IpUnavailableReason = (typeof IP_UNAVAILABLE_REASONS)[number];

/** The canonical channel when nothing else identifies the source. */
export const DIRECT_CHANNEL = "direct";

/** Raw attribution as a surface hands it over — any of it may be absent or junk. */
export interface RawAttribution {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  sourceUrl?: string | null;
  referrer?: string | null;
  landingSource?: string | null;
  /** An affiliate id from a cookie or a `?ref=` — validated by the caller against `affiliates`. */
  affiliateId?: string | null;
  /** Server-captured only. A caller must never pass a client-supplied address. */
  ipAddress?: string | null;
  /** Why the address is absent, when it is. */
  ipUnavailableReason?: IpUnavailableReason | null;
}

/** The normalised columns, ready to write to `vehicle_requests` or `buyer_opportunities`. */
export interface NormalizedAttribution {
  acquisitionChannel: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  sourceUrl: string | null;
  referrer: string | null;
  landingSource: string | null;
  affiliateId: string | null;
  ipAddress: string | null;
  ipUnavailableReason: IpUnavailableReason | null;
}

/** Trim, and treat an empty or whitespace-only string as absent. */
function clean(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * A valid absolute http(s) URL, or NULL.
 *
 * §8.2: "`source_url`/`referrer` a valid URL or NULL". A referrer arrives from the
 * browser and can be anything — `android-app://`, a bare hostname, a truncated
 * string. Storing junk in a URL column makes every later attribution query guess.
 */
export function normalizeUrl(value: string | null | undefined): string | null {
  const raw = clean(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Derive the canonical channel, server-side.
 *
 * Precedence, most specific first: an affiliate referral is an affiliate
 * acquisition whatever else is on the URL; an explicit `utm_source` names the
 * channel; a `landing_source` (the semantic SEO form id) is the organic channel;
 * an external referrer is `referral`; anything else is `direct`.
 *
 * The value is never null and never a sentinel in some other column — it is the ONE
 * place "where did this come from" is recorded.
 */
export function deriveAcquisitionChannel(raw: RawAttribution, appHost?: string | null): string {
  if (clean(raw.affiliateId)) return "affiliate";
  const utm = clean(raw.utmSource);
  if (utm) return utm.toLowerCase();
  const landing = clean(raw.landingSource);
  if (landing) return landing.toLowerCase();

  const referrer = normalizeUrl(raw.referrer);
  if (referrer) {
    try {
      const host = new URL(referrer).host;
      // A referrer from our own site is not an acquisition — it is navigation.
      if (appHost && host === appHost) return DIRECT_CHANNEL;
      return "referral";
    } catch {
      return DIRECT_CHANNEL;
    }
  }
  return DIRECT_CHANNEL;
}

/**
 * Normalise raw attribution into the exact columns.
 *
 * The IP rule, stated once: an address is written when it was captured
 * server-side, and NULL otherwise — with a reason. Never a sentinel. The two are
 * mutually exclusive, and the Phase 1 migration enforces that with a CHECK, so a
 * caller that supplies both gets the address and no reason (the address is the
 * stronger fact) rather than a write that the database rejects.
 */
export function normalizeAttribution(raw: RawAttribution, appHost?: string | null): NormalizedAttribution {
  const ipAddress = clean(raw.ipAddress);
  return {
    acquisitionChannel: deriveAcquisitionChannel(raw, appHost),
    utmSource: clean(raw.utmSource),
    utmMedium: clean(raw.utmMedium),
    utmCampaign: clean(raw.utmCampaign),
    utmContent: clean(raw.utmContent),
    sourceUrl: normalizeUrl(raw.sourceUrl),
    referrer: normalizeUrl(raw.referrer),
    landingSource: clean(raw.landingSource),
    affiliateId: clean(raw.affiliateId),
    ipAddress,
    ipUnavailableReason: ipAddress ? null : (raw.ipUnavailableReason ?? "UNKNOWN"),
  };
}

/**
 * Capture the client address from a request, server-side.
 *
 * Returns the address OR a reason it is absent — never a placeholder. Only
 * forwarding headers a trusted proxy sets are read; a client-supplied
 * `X-Forwarded-For` on a direct connection is not evidence of anything, but on
 * Vercel every request passes through the platform proxy, so the leftmost entry is
 * the one the platform observed.
 */
export function captureClientIp(headers: Headers): { ipAddress: string | null; ipUnavailableReason: IpUnavailableReason | null } {
  const candidates = [headers.get("x-vercel-forwarded-for"), headers.get("x-forwarded-for"), headers.get("x-real-ip")];
  for (const candidate of candidates) {
    const first = clean(candidate?.split(",")[0]);
    if (first) return { ipAddress: first, ipUnavailableReason: null };
  }
  return { ipAddress: null, ipUnavailableReason: "PROXY_HEADER_ABSENT" };
}
