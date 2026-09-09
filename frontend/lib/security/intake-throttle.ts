// lib/security/intake-throttle.ts — the bound on the two PUBLIC intake routes.
//
// Neither `/api/public/request-vehicle` nor `.../complete` had any limiter. That
// is what turned the §7.2 claim prompt into an amplifier: every post at a
// registered address minted a 5-day write credential and sent a mail, and nothing
// bounded how many posts there could be. The service now issues one live
// credential per target buyer; this bounds the submissions themselves, and the
// rows they write.
//
// Two keys, as the auth tier does it — neither alone is the subject:
//   • IP, generously (shared NAT is ordinary, and a family or an office should
//     not lock each other out);
//   • the normalised address, tightly, because repeatedly submitting the SAME
//     address is the abuse shape.
//
// `limitGeneral` FAILS OPEN on a store outage, which is the right direction here:
// a visitor must never lose a request to a Redis blip. When no store is
// configured at all it passes through and warns once (production only).

import { limitGeneral, clientIpKey, type RateLimitResult } from "@/lib/security/rate-limit";
import { normalizeEmail } from "@/lib/services/acquisition/intake-identity";

/** What a caller does with a refusal. `null` means "carry on". */
export interface ThrottleRefusal {
  status: 429 | 503;
  message: string;
}

const IP_LIMIT = { tokens: 20, window: "1 h" } as const;
const EMAIL_LIMIT = { tokens: 5, window: "1 h" } as const;

function refuse(result: RateLimitResult): ThrottleRefusal | null {
  return result.ok ? null : { status: result.status, message: result.message };
}

/**
 * The IP half. Called BEFORE the request body is parsed, because on the intake
 * route parsing a multipart body uploads the pre-approval file to storage — an
 * unauthenticated 10 MB write that a limiter placed after validation never sees.
 *
 * `clientIpKey` returns the literal "unknown" when no forwarding header is
 * present. Keying on that would put every such request into ONE bucket, so a
 * misconfigured ingress could 429 the whole platform's intake after 20 requests
 * an hour. An unidentifiable caller is therefore not throttled by IP at all — the
 * address key below is what still bounds them.
 */
export async function throttleIntakeByIp(headers: Headers, scope: string): Promise<ThrottleRefusal | null> {
  const ip = clientIpKey(headers);
  if (ip === "unknown") return null;
  return refuse(await limitGeneral(`${scope}:ip:${ip}`, IP_LIMIT));
}

/** The address half. Called once the body is parsed and an email is known. */
export async function throttleIntakeByEmail(rawEmail: unknown, scope: string): Promise<ThrottleRefusal | null> {
  const email = normalizeEmail(typeof rawEmail === "string" ? rawEmail : null);
  if (!email) return null;
  return refuse(await limitGeneral(`${scope}:email:${email}`, EMAIL_LIMIT));
}
