// lib/services/esign/invited-signer.service.ts
//
// §13-D30's INVITED-SIGNER LINK. Owner-authorised 2026-09-15, with six conditions.
//
// WHY THIS EXISTS. A required co-buyer has no platform account — that is the owner's own
// §13-D30 ruling, not an oversight — and the signing link landed on `/buyer/esign`, which
// calls `requireBuyer()` and redirects to Supabase sign-in. So the CO_BUYER envelope was
// reachable by nobody: `signatureProgress.allSigned` never became true, `ensureDealSigned`
// never advanced, and every deal with `co_buyers.is_required_signer` set deadlocked at
// SIGNING_PENDING until the envelope expired at 14 days.
//
// WHY IT WAS WITHHELD FROM THE FIRST WAVE, and why that was right: a route that lets a party
// with no platform account legally execute a contract is a SERVER-AUTHORIZATION change, and
// CLAUDE.md puts those behind separate explicit authorization. The §13-D30 ruling settled the
// DESIGN. It was not the authorization for the surface. The authorization came separately.
//
// THE MECHANISM IS NOT NEW, which is the reason it could be authorised at all. Phase 2's
// `dealer_account_claim_tokens` and Phase 5's `auction_invitations` both mint a hashed,
// expiring, subject-bound token reachable without an account. This is the same shape at
// higher stakes — so it REUSES `account-claim.service.ts`'s `hashToken` / `generateRawToken`
// rather than introducing a second token scheme, and copies its
// `{ ok: true } | { ok: false; reason }` result shape rather than throwing.
//
// ─── THE SIX CONDITIONS, AND WHERE EACH IS ENFORCED ─────────────────────────
//
//  1. SINGLE USE — `consumeSignerToken` is a compare-and-swap on
//     `signerAccessTokenConsumedAt: null`, so two concurrent clicks cannot both win.
//     Phase 5's H2 was a token written and never consumed; that is the named mistake this
//     function exists not to repeat, and `phase8-invited-signer.test.ts` pins it.
//  2. BOUND TO BOTH the deal AND the specific `co_buyers` row — `resolveSignerToken`
//     re-checks `signerKind === "CO_BUYER"`, a non-null `coBuyerId`, and that the CoBuyer
//     still belongs to this deal's buyer. It never infers the subject from the hash alone.
//  3. SHORT EXPIRY, CEILINGED — `SIGNER_TOKEN_TTL_MS` is 72 hours, and `issueSignerToken`
//     takes `min(now + TTL, envelope.expiresAt)`. A signing token can never outlive the
//     version it signs. Both expiries are checked at resolve time, independently.
//  4. THIS SURFACE AND NOTHING ELSE — `InvitedSignerView` is an explicit projection. No
//     other deal, no financing, no dealer identity, no admin field, and of the primary
//     buyer only the first name, because the co-buyer is signing a contract alongside a
//     person they must be able to identify.
//  5. OWN EVIDENCE — the caller passes the co-buyer's own consent acknowledgments, IP,
//     user agent and adopted name straight into `recordBuyerSignature`, which already
//     accepts `signerKind` and `coBuyerId`. No new evidence path.
//  6. A SPENT OR EXPIRED TOKEN IS A NAMED STATE, NOT AN ERROR — the reasons below are
//     rendered as sentences. A co-buyer clicking their link twice is the COMMON case; the
//     second click must explain, not fail.

import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashToken, generateRawToken } from "@/lib/services/dealer-recruitment/account-claim.service";

/**
 * 72 hours. Deliberately much shorter than the envelope's 14 days: the link is a bearer
 * credential sitting in an inbox, and the blast radius of a forwarded or breached mailbox
 * scales with how long it stays live. A co-buyer who misses the window is re-invited, which
 * costs one email; a link that stays valid for a fortnight cannot be un-sent.
 */
export const SIGNER_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

export interface IssuedSignerToken {
  /** Raw token — embed in the emailed link ONLY. Never stored, never logged. */
  rawToken: string;
  expiresAt: Date;
}

export type SignerTokenReason =
  | "not_found"
  | "consumed"
  | "expired"
  | "envelope_not_signable"
  | "not_a_co_buyer_token"
  | "subject_mismatch";

export type SignerTokenResolution =
  | { ok: true; view: InvitedSignerView }
  | { ok: false; reason: SignerTokenReason };

/**
 * Everything the invited signer may see — condition 4, as a type rather than a promise.
 *
 * Adding a field here is a deliberate widening of what a bearer token discloses, so it is
 * the place to argue for one. Nothing about the dealership, the financing, the other party's
 * contact details, or any other deal appears, and `dealId` is present only because the
 * signing POST needs it.
 */
export interface InvitedSignerView {
  envelopeId: string;
  dealId: string;
  coBuyerId: string;
  /** The co-buyer's own name, as the deal records it — they confirm or adopt it when signing. */
  coBuyerName: string;
  /** First name only: enough to know whose contract this is, and no more. */
  primaryBuyerFirstName: string | null;
  vehicle: string;
  vin: string | null;
  /** The version being signed, so the ceremony can bind the signature to a document hash. */
  documentVersionId: string | null;
  documentHash: string | null;
  /** The EARLIER of the token's expiry and the envelope's — whichever closes the window first. */
  signingClosesAt: Date | null;
}

/**
 * Mint a link for a prepared CO_BUYER envelope. Returns the raw token for the email; only the
 * hash is persisted.
 *
 * Re-minting REPLACES the previous hash, which revokes the old link — deliberate, so a
 * re-invite cannot leave two live credentials for one signature. Refuses a consumed envelope
 * rather than quietly issuing a token that `resolveSignerToken` would then reject.
 */
export async function issueSignerToken(params: {
  dealId: string;
  coBuyerId: string;
  now?: Date;
}): Promise<IssuedSignerToken | null> {
  const now = params.now ?? new Date();

  const envelope = await prisma.eSignEnvelope.findFirst({
    where: { dealId: params.dealId, signerKind: "CO_BUYER", coBuyerId: params.coBuyerId },
    select: { id: true, status: true, expiresAt: true, signerAccessTokenConsumedAt: true },
  });
  if (!envelope) return null;
  if (envelope.status === "COMPLETED") return null;
  if (envelope.signerAccessTokenConsumedAt) return null;

  const rawToken = generateRawToken();
  // CONDITION 3, applied here rather than trusted to the caller: the envelope's own expiry is
  // the ceiling. `Math.min` on two dates is the whole rule — a token cannot outlive the
  // document version it authorises a signature on.
  const ttlExpiry = new Date(now.getTime() + SIGNER_TOKEN_TTL_MS);
  const expiresAt =
    envelope.expiresAt && envelope.expiresAt.getTime() < ttlExpiry.getTime()
      ? envelope.expiresAt
      : ttlExpiry;

  await prisma.eSignEnvelope.update({
    where: { id: envelope.id },
    data: {
      signerAccessTokenHash: hashToken(rawToken),
      signerAccessTokenExpiresAt: expiresAt,
      signerAccessTokenConsumedAt: null,
    },
  });

  return { rawToken, expiresAt };
}

/**
 * Resolve a raw token to the one thing it authorises. Reads only; never consumes, never
 * grants, never writes — so a GET of the signing page is safe to repeat and a crawler
 * following the link cannot spend it.
 */
export async function resolveSignerToken(rawToken: string, now: Date = new Date()): Promise<SignerTokenResolution> {
  if (!rawToken || rawToken.length < 32) return { ok: false, reason: "not_found" };

  const envelope = await prisma.eSignEnvelope.findUnique({
    where: { signerAccessTokenHash: hashToken(rawToken) },
    select: {
      id: true, dealId: true, coBuyerId: true, signerKind: true, status: true,
      expiresAt: true, documentVersionId: true, documentHash: true,
      signerAccessTokenExpiresAt: true, signerAccessTokenConsumedAt: true,
      deal: {
        select: {
          buyerId: true, vin: true, vehicleYear: true, vehicleMake: true, vehicleModel: true,
          buyer: { select: { firstName: true } },
        },
      },
      coBuyer: { select: { id: true, buyerId: true, legalFirstName: true, legalLastName: true, isRequiredSigner: true } },
    },
  });

  if (!envelope) return { ok: false, reason: "not_found" };

  // CONDITION 1 — spent is spent. Checked before expiry so a co-buyer who already signed is
  // told they already signed, rather than being told their link expired.
  if (envelope.signerAccessTokenConsumedAt) return { ok: false, reason: "consumed" };

  // CONDITION 3 — BOTH expiries, independently. The token's own, and the envelope's, because
  // an envelope can be expired or voided by a contract revision without the token being
  // touched, and a signature on a superseded version is exactly what must not happen.
  if (envelope.signerAccessTokenExpiresAt && envelope.signerAccessTokenExpiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  if (envelope.expiresAt && envelope.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  // CONDITION 2 — bound to both, re-checked rather than inferred. A token that somehow
  // addressed a BUYER envelope would otherwise let a bearer sign as the primary buyer.
  if (envelope.signerKind !== "CO_BUYER") return { ok: false, reason: "not_a_co_buyer_token" };
  if (!envelope.coBuyerId || !envelope.coBuyer) return { ok: false, reason: "not_a_co_buyer_token" };
  // ...and the co-buyer must still belong to THIS deal's buyer. A CoBuyer row moved or
  // re-pointed after the link was sent must not remain signable through the old credential.
  if (!envelope.deal || envelope.coBuyer.buyerId !== envelope.deal.buyerId) {
    return { ok: false, reason: "subject_mismatch" };
  }
  // A co-buyer who is no longer a REQUIRED signer has nothing to sign. Fail closed: the
  // deal's own requirement changed, and the stale link must not outlive it.
  if (!envelope.coBuyer.isRequiredSigner) return { ok: false, reason: "subject_mismatch" };

  // Only a live, prepared envelope is signable — the same states recordBuyerSignature
  // accepts, checked here so the page renders a sentence instead of the POST throwing.
  if (!["SENT", "DELIVERED", "PENDING"].includes(envelope.status)) {
    return { ok: false, reason: envelope.status === "COMPLETED" ? "consumed" : "envelope_not_signable" };
  }

  const vehicle =
    [envelope.deal.vehicleYear, envelope.deal.vehicleMake, envelope.deal.vehicleModel]
      .filter(Boolean)
      .join(" ") || "your vehicle";

  // Whichever window closes first is the one the co-buyer is told about. Showing the later
  // of the two would promise time that does not exist.
  const closes = [envelope.signerAccessTokenExpiresAt, envelope.expiresAt].filter(Boolean) as Date[];
  const signingClosesAt = closes.length
    ? new Date(Math.min(...closes.map((d) => d.getTime())))
    : null;

  return {
    ok: true,
    view: {
      envelopeId: envelope.id,
      dealId: envelope.dealId,
      coBuyerId: envelope.coBuyerId,
      coBuyerName: [envelope.coBuyer.legalFirstName, envelope.coBuyer.legalLastName].filter(Boolean).join(" "),
      primaryBuyerFirstName: envelope.deal.buyer?.firstName ?? null,
      vehicle,
      vin: envelope.deal.vin,
      documentVersionId: envelope.documentVersionId,
      documentHash: envelope.documentHash,
      signingClosesAt,
    },
  };
}

/**
 * CONDITION 1, as a compare-and-swap. Returns true only if THIS call spent the token.
 *
 * Called AFTER the signature is recorded, deliberately: a token spent before the signature
 * lands would strand a co-buyer whose signature then failed, with no way back in. The cost of
 * this ordering is that a crash between the two leaves a live token on a COMPLETED envelope —
 * which `resolveSignerToken` already refuses on status, so the window is closed from the
 * other side too.
 */
export async function consumeSignerToken(envelopeId: string, now: Date = new Date()): Promise<boolean> {
  const res = await prisma.eSignEnvelope.updateMany({
    where: { id: envelopeId, signerAccessTokenConsumedAt: null },
    data: { signerAccessTokenConsumedAt: now },
  });
  return res.count === 1;
}

/** Constant-time compare, for callers that need to match a token outside the hash lookup. */
export function signerTokenMatches(rawToken: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(rawToken));
  const b = Buffer.from(storedHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
