// Y1 — first-party email-deliverability adapter.
//
// Confirms a candidate address's domain can actually receive mail by resolving
// its MX records via node:dns. No third-party provider, no env, no key. This is
// the verify-BEFORE-persist gate for prospect email acquisition: an address is
// stored (and later cold-emailed) ONLY when its domain has a live MX record.
//
// FAIL-CLOSED on every failure mode — invalid format, missing domain, no MX
// record, or any DNS/resolution error (including offline) — so a bad or
// unverifiable address is never treated as deliverable.
//
// NOTE: real DNS resolution is NOT VERIFIED in the offline/hermetic test
// environment; the unit tests mock node:dns/promises and pin the branching only.

import dns from "node:dns/promises";

export interface DeliverabilityResult {
  deliverable: boolean;
  reason: string;
}

// Permissive local/domain parts, but rejects whitespace and obviously-broken
// values. Mirrors the EMAIL_REGEX used in email-enrichment.service.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function verifyEmailDeliverability(email: string): Promise<DeliverabilityResult> {
  const clean = email?.trim().toLowerCase();
  if (!clean || !EMAIL_RE.test(clean)) return { deliverable: false, reason: "invalid_format" };

  const domain = clean.split("@")[1];
  if (!domain) return { deliverable: false, reason: "no_domain" };

  try {
    const mx = await dns.resolveMx(domain);
    if (!mx || mx.length === 0) return { deliverable: false, reason: "no_mx" };
    return { deliverable: true, reason: "mx_ok" };
  } catch {
    // Fail closed: DNS error, offline, or SERVFAIL — never assume deliverable.
    return { deliverable: false, reason: "mx_lookup_failed" };
  }
}
