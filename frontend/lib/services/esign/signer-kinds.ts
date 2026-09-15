// lib/services/esign/signer-kinds.ts
//
// The PURE half of required-signers.ts — the three helpers that answer "who must sign?" and
// "is everyone done?" from data a caller already holds.
//
// SPLIT OUT FOR ONE REASON, and it is a real one rather than tidiness: required-signers.ts
// imports `@/lib/prisma`, so a "use client" component cannot import from it without pulling
// the database client into the browser bundle. The admin command centre needs exactly this
// logic on the client, and the alternative — restating the rule inline — is how two copies of
// "is this deal signed?" drift apart, which is the whole defect §13-D30's cutover was about.
//
// required-signers.ts re-exports all three, so every existing import keeps working and there
// is still ONE implementation.

import type { ESignSignerKind } from "@prisma/client";

export function pickSignerEnvelope<T extends { signerKind: ESignSignerKind }>(
  envelopes: T[] | null | undefined,
  signerKind: ESignSignerKind = "BUYER",
): T | null {
  return envelopes?.find((e) => e.signerKind === signerKind) ?? null;
}

/**
 * Whether every signer in `requiredKinds` has a COMPLETED envelope in the loaded list.
 *
 * Fail-closed on an empty `requiredKinds`, for the same reason `allSigned` is: a caller
 * that could not resolve who was required must never be told the contract is signed.
 */
export function allSignedFrom<T extends { signerKind: ESignSignerKind; status: string }>(
  envelopes: T[] | null | undefined,
  requiredKinds: ESignSignerKind[],
): boolean {
  if (!requiredKinds.length) return false;
  return requiredKinds.every(
    (kind) => envelopes?.some((e) => e.signerKind === kind && e.status === "COMPLETED") ?? false,
  );
}

/**
 * The signer kinds a loaded deal requires, from the co-buyer record the surface already
 * selected. Mirrors `requiredSignersForDeal` for the no-extra-query case.
 */
export function requiredKindsFrom(
  coBuyer: { isRequiredSigner: boolean } | null | undefined,
): ESignSignerKind[] {
  return coBuyer?.isRequiredSigner ? ["BUYER", "CO_BUYER"] : ["BUYER"];
}
