// WO-2 — Secure dealer account-claim tokens.
//
// When an admin approves a DealerApplication we create the dealer's Supabase user
// WITHOUT a known password and issue a single-use, hashed, 7-day claim token. The
// dealer sets their own password via /dealer/claim. We persist ONLY the SHA-256
// hash; the raw token exists solely in the emailed link, so a DB leak cannot be
// replayed into an account takeover.

import crypto from "crypto"
import { prisma } from "@/lib/prisma"

const CLAIM_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export function hashClaimToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex")
}

export interface IssuedClaimToken {
  /** Raw token — embed in the emailed link ONLY; never stored or logged. */
  rawToken: string
  expiresAt: Date
}

/**
 * Mint a claim token for a dealer. Returns the raw token (for the email link)
 * and its expiry; persists only the hash.
 */
export async function issueClaimToken(params: {
  dealerId: string
  applicationId?: string | null
  createdByAdminId: string
}): Promise<IssuedClaimToken> {
  const rawToken = crypto.randomBytes(32).toString("hex")
  const tokenHash = hashClaimToken(rawToken)
  const expiresAt = new Date(Date.now() + CLAIM_TOKEN_TTL_MS)

  await prisma.dealerAccountClaimToken.create({
    data: {
      tokenHash,
      dealerId: params.dealerId,
      applicationId: params.applicationId ?? null,
      expiresAt,
      createdByAdminId: params.createdByAdminId,
    },
  })

  return { rawToken, expiresAt }
}

export type ClaimTokenValidation =
  | { ok: true; tokenId: string; dealerId: string; applicationId: string | null }
  | { ok: false; reason: "not_found" | "consumed" | "expired" }

/**
 * Validate a raw claim token without consuming it (used by the GET preview).
 */
export async function validateClaimToken(
  rawToken: string,
): Promise<ClaimTokenValidation> {
  const tokenHash = hashClaimToken(rawToken)
  const record = await prisma.dealerAccountClaimToken.findUnique({
    where: { tokenHash },
  })
  if (!record) return { ok: false, reason: "not_found" }
  if (record.consumedAt) return { ok: false, reason: "consumed" }
  if (record.expiresAt < new Date()) return { ok: false, reason: "expired" }
  return {
    ok: true,
    tokenId: record.id,
    dealerId: record.dealerId,
    applicationId: record.applicationId,
  }
}

/**
 * Atomically mark a token consumed. Uses a conditional update (consumedAt: null)
 * so two concurrent claims can never both succeed. Returns true if THIS call won.
 */
export async function consumeClaimToken(tokenId: string): Promise<boolean> {
  const res = await prisma.dealerAccountClaimToken.updateMany({
    where: { id: tokenId, consumedAt: null },
    data: { consumedAt: new Date() },
  })
  return res.count === 1
}
