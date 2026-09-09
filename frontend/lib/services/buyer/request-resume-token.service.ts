// Secure request-resume token for the $99 pre-checkout conversion funnel.
//
// Replaces the insecure `/thank-you?email=<plaintext>` resume link. A pre-checkout
// reminder embeds a RAW token; we persist ONLY its SHA-256 hash, so a DB leak
// cannot reconstruct the emailed link. Modeled 1:1 on the blessed dealer pattern
// (lib/services/dealer-recruitment/account-claim.service.ts): 256-bit random,
// hashed at rest, expiring, single-use via a race-safe conditional update.
//
// SECURITY POSTURE — the token is a DEEP-LINK with ONE bounded write.
//
// Originally it granted nothing: the resume route validated and consumed it and
// 302-redirected to the auth-gated /buyer/deposit, so the clicker's own Supabase
// session was the whole access boundary.
//
// Phase 2 made it rule 16's tier 2, which widens it: presenting the token to
// POST /api/public/request-vehicle/complete supplies vehicle detail on the ONE
// request the token names, with no session. That is the point — the emailed
// "finish your request" link has to work for someone who has not registered — but
// it means the token is a capability now, so it is bounded on three sides:
//
//   • it names its own `vehicleRequestId`, and the route re-reads that row scoped
//     to the token's buyer, so it can never reach a different request;
//   • it is CONSUMED by that route on success, so a forwarded link works once;
//   • it still grants no session and reaches no auth-gated page.
//
// It remains 256-bit random and hashed at rest, so a database leak cannot
// reconstruct an emailed link.

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import type { PrismaClient, Prisma } from "@prisma/client";

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
export async function issueResumeToken(
  params: {
    buyerId: string;
    vehicleRequestId?: string | null;
  },
  // Accepts a transaction handle so a token can be minted in the same transaction
  // as the capture that needs it — the message and the state it refers to commit
  // together, or neither does (§27).
  db: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<IssuedResumeToken> {
  const rawToken = crypto.randomBytes(32).toString("hex"); // 256-bit, unguessable
  const tokenHash = hashResumeToken(rawToken);
  const expiresAt = new Date(Date.now() + RESUME_TOKEN_TTL_MS);

  await db.buyerRequestClaimToken.create({
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
  // EXPLICIT SELECT, not a bare findUnique. Prisma's default read selects every
  // scalar the model declares, so the moment `schema.prisma` declares a column the
  // database does not yet have, every call here raises `42703 undefined_column` —
  // which is this function, the tier-2 claim lookup and the consume, i.e. both the
  // $99 resume link and the rule-16 claim link at once. Naming the five columns
  // this function actually uses confines that window to the code that genuinely
  // needs a new column (IMPLEMENTATION-WORKFLOW §8.1a.2 documents the same failure
  // at wave scale).
  const record = await prisma.buyerRequestClaimToken.findUnique({
    where: { tokenHash },
    select: { id: true, buyerId: true, vehicleRequestId: true, consumedAt: true, expiresAt: true },
  });
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
 *
 * Takes a `db` handle for the same reason `issueResumeToken` does, and it is not
 * symmetry for its own sake. The intake write path consumes the token that
 * authorised it from INSIDE `prisma.$transaction` (unified-buyer-intake.service.ts).
 * Bound to the module-level client, this would commit on its own connection: the
 * token would burn even when the intake it authorised rolled back, and the visitor
 * would be left holding a dead link to a request that was never written. Defaulted,
 * so the two existing single-argument callers — the resume route and
 * `/api/public/request-vehicle/complete` — are unchanged.
 */
export async function consumeResumeToken(
  tokenId: string,
  db: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const res = await db.buyerRequestClaimToken.updateMany({
    where: { id: tokenId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return res.count === 1;
}
