// Secure request-resume token for the $99 pre-checkout conversion funnel.
//
// Replaces the insecure `/thank-you?email=<plaintext>` resume link. A pre-checkout
// reminder embeds a RAW token; we persist ONLY its SHA-256 hash, so a DB leak
// cannot reconstruct the emailed link. Modeled 1:1 on the blessed dealer pattern
// (lib/services/dealer-recruitment/account-claim.service.ts): 256-bit random,
// hashed at rest, expiring, single-use via a race-safe conditional update.
//
// SECURITY POSTURE — the token is a DEEP-LINK, not a credential. The resume route
// validates+consumes it and 302-redirects to the auth-gated /buyer/deposit; it
// grants NO authenticated capability on its own. The clicker's own Supabase
// session (and the existing guest-request email transfer at signup) remain the
// real access boundary. So even a stolen/guessed token cannot view or claim
// another buyer's request — it only reaches the shared, auth-gated checkout.

import crypto from "crypto";
import { prisma } from "@/lib/prisma";

// The pre-checkout conversion window is a few days; 5d comfortably covers the
// latency between a reminder send and a click. A fresh token is minted per send,
// so this TTL only bounds click latency, not the whole funnel.
const RESUME_TOKEN_TTL_MS = 5 * 24 * 60 * 60 * 1000;

export function hashResumeToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export interface IssuedResumeToken {
  /** Raw token — embed in the emailed resume link ONLY; never stored or logged. */
  rawToken: string;
  expiresAt: Date;
}

/**
 * Mint a resume token for a buyer's saved competitive request. Returns the raw
 * token (for the link) + expiry; persists only the hash.
 */
export async function issueResumeToken(params: {
  buyerId: string;
  vehicleRequestId?: string | null;
}): Promise<IssuedResumeToken> {
  const rawToken = crypto.randomBytes(32).toString("hex"); // 256-bit, unguessable
  const tokenHash = hashResumeToken(rawToken);
  const expiresAt = new Date(Date.now() + RESUME_TOKEN_TTL_MS);

  await prisma.buyerRequestClaimToken.create({
    data: {
      tokenHash,
      buyerId: params.buyerId,
      vehicleRequestId: params.vehicleRequestId ?? null,
      expiresAt,
    },
  });

  return { rawToken, expiresAt };
}

export type ResumeTokenValidation =
  | { ok: true; tokenId: string; buyerId: string; vehicleRequestId: string | null }
  | { ok: false; reason: "not_found" | "consumed" | "expired" };

/**
 * Validate a raw resume token (hash lookup — never a plaintext compare). Does not
 * consume it, so a re-render/preview is safe.
 */
export async function validateResumeToken(rawToken: string): Promise<ResumeTokenValidation> {
  if (!rawToken || typeof rawToken !== "string") return { ok: false, reason: "not_found" };
  const tokenHash = hashResumeToken(rawToken);
  const record = await prisma.buyerRequestClaimToken.findUnique({ where: { tokenHash } });
  if (!record) return { ok: false, reason: "not_found" };
  if (record.consumedAt) return { ok: false, reason: "consumed" };
  if (record.expiresAt < new Date()) return { ok: false, reason: "expired" };
  return {
    ok: true,
    tokenId: record.id,
    buyerId: record.buyerId,
    vehicleRequestId: record.vehicleRequestId,
  };
}

/**
 * Atomically mark a token consumed. Conditional update (consumedAt: null) so two
 * concurrent clicks can never both win. Returns true if THIS call consumed it.
 */
export async function consumeResumeToken(tokenId: string): Promise<boolean> {
  const res = await prisma.buyerRequestClaimToken.updateMany({
    where: { id: tokenId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return res.count === 1;
}
