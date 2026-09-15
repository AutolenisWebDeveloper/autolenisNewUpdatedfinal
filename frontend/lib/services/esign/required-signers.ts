// lib/services/esign/required-signers.ts
//
// THE single answer to "who must sign this deal, and is everyone done?".
//
// WHY THIS FILE EXISTS. Until Phase 8 a deal carried exactly one envelope —
// `e_sign_envelopes.deal_id` was absolutely unique — so "the deal is signed" was a
// property of one row, and a dozen surfaces read it that way:
//
//     deal.eSignEnvelope?.status === "COMPLETED"
//
// §13-D30 drops that unique so the co-buyer can hold a second envelope, and every one
// of those reads silently becomes "SOME signer finished" rather than "EVERY required
// signer finished". A buyer could sign, the co-buyer never could, and pickup would be
// allowed — the exact failure Stage 13/14c exists to prevent ("The buyer signs. The
// co-buyer signs when named as a required signer.").
//
// So the derivation lives in ONE place. Re-deriving it inline at each call site is how
// twelve surfaces come to disagree about what "signed" means.
//
// WHO IS REQUIRED. The buyer, always. The co-buyer only when `CoBuyer.isRequiredSigner`
// is set — the flag Phase 1 added for exactly this and which nothing has read until now.
// A co-buyer who is named on the deal but NOT marked a required signer is a
// co-applicant for financing, not a signatory, and must not block the contract.

import { prisma } from "@/lib/prisma";
import type { ESignSignerKind, Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

export interface RequiredSigner {
  signerKind: ESignSignerKind;
  /** Null for the BUYER row; the CoBuyer.id for the co-buyer. */
  coBuyerId: string | null;
  name: string | null;
  email: string | null;
}

export interface SignatureProgress {
  required: RequiredSigner[];
  /** Signer kinds whose envelope is COMPLETED. */
  completed: ESignSignerKind[];
  /** Signer kinds with no envelope yet, or an envelope that is not terminal. */
  outstanding: ESignSignerKind[];
  /** Signer kinds whose envelope reached DECLINED / VOIDED / EXPIRED. */
  blocked: ESignSignerKind[];
  /**
   * TRUE only when every required signer has a COMPLETED envelope. This is the
   * predicate every release-adjacent gate must use. Note it is false for a deal with
   * no required signers resolved at all — fail-closed, because "nobody is required"
   * is far more likely to mean "the deal could not be read" than "this contract needs
   * no signatures".
   */
  allSigned: boolean;
}

/**
 * The signers this deal requires. Fail-closed: a deal that cannot be read yields an
 * empty list, and `allSigned` is false for an empty list, so an unreadable deal never
 * reads as fully signed.
 */
export async function requiredSignersForDeal(dealId: string, db: Db = prisma): Promise<RequiredSigner[]> {
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    select: {
      buyer: { select: { firstName: true, lastName: true, user: { select: { email: true } } } },
      coBuyer: {
        select: {
          id: true,
          legalFirstName: true,
          legalLastName: true,
          email: true,
          isRequiredSigner: true,
        },
      },
    },
  });
  if (!deal) return [];

  const signers: RequiredSigner[] = [
    {
      signerKind: "BUYER",
      coBuyerId: null,
      name: [deal.buyer?.firstName, deal.buyer?.lastName].filter(Boolean).join(" ") || null,
      email: deal.buyer?.user?.email ?? null,
    },
  ];

  // The flag, not the presence of the record. A co-buyer exists on many deals as a
  // financing co-applicant; only `isRequiredSigner` makes them a signatory.
  if (deal.coBuyer?.isRequiredSigner) {
    signers.push({
      signerKind: "CO_BUYER",
      coBuyerId: deal.coBuyer.id,
      name:
        [deal.coBuyer.legalFirstName, deal.coBuyer.legalLastName].filter(Boolean).join(" ") || null,
      email: deal.coBuyer.email ?? null,
    });
  }
  return signers;
}

/**
 * Where every required signer stands. ONE query for the envelopes, so a surface that
 * renders the signature block and a gate that decides release cannot disagree.
 */
export async function signatureProgress(dealId: string, db: Db = prisma): Promise<SignatureProgress> {
  const required = await requiredSignersForDeal(dealId, db);
  if (required.length === 0) {
    return { required: [], completed: [], outstanding: [], blocked: [], allSigned: false };
  }

  const envelopes = await db.eSignEnvelope.findMany({
    where: { dealId, signerKind: { in: required.map((s) => s.signerKind) } },
    select: { signerKind: true, status: true },
  });
  const byKind = new Map(envelopes.map((e) => [e.signerKind, e.status]));

  const completed: ESignSignerKind[] = [];
  const outstanding: ESignSignerKind[] = [];
  const blocked: ESignSignerKind[] = [];

  for (const signer of required) {
    const status = byKind.get(signer.signerKind);
    if (status === "COMPLETED") completed.push(signer.signerKind);
    else if (status && ["DECLINED", "VOIDED", "EXPIRED"].includes(status)) blocked.push(signer.signerKind);
    else outstanding.push(signer.signerKind);
  }

  return {
    required,
    completed,
    outstanding,
    blocked,
    allSigned: completed.length === required.length,
  };
}

/**
 * The release-gate predicate, on its own so a caller that needs nothing else does not
 * have to know the shape of SignatureProgress. Fail-closed by construction — see the
 * note on `allSigned`.
 */
export async function allRequiredSignaturesComplete(dealId: string, db: Db = prisma): Promise<boolean> {
  return (await signatureProgress(dealId, db)).allSigned;
}

// ── Pure helpers for surfaces that ALREADY loaded the envelopes ───────────────
// A page that has `deal.eSignEnvelopes` in hand must not issue another query just to
// answer "whose is this?". These are the same derivation without the round trip, so a
// rendered surface and a server-side gate cannot drift apart.

/** One signer's envelope out of a loaded list, or null. */

// The pure helpers live in ./signer-kinds so a client component can import them without
// pulling `@/lib/prisma` into the browser bundle. Re-exported here so every existing import
// of this module keeps working and there remains exactly ONE implementation of each.
export { pickSignerEnvelope, allSignedFrom, requiredKindsFrom } from "./signer-kinds";
