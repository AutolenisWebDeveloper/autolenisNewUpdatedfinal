// lib/services/dealer/dealer-verification.service.ts — Batch 2
//
// Dealer license + identity verification records. Fixes FS-C (license step
// advanced with no DealerLicense / DealerVerification record and no validation).
//
// Truthfulness boundary: deterministic FORMAT/PRESENCE validation is NOT the same
// as authoritative verification. Recording a license marks DealerVerification
// `verified = false` (pending). Only an admin action (verifyDealerLicense) — or a
// future licensed-registry integration — may set `verified = true`. This keeps the
// verification signal honest.

import { prisma } from "@/lib/prisma";

/** Deterministic, provider-free license-number format check. */
export function isValidLicenseFormat(licenseNumber: string): boolean {
  const v = licenseNumber.trim();
  // 3–32 chars, alphanumeric with internal dashes, starts alphanumeric.
  return /^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/.test(v);
}

function isValidStateCode(state: string | null | undefined): boolean {
  return !!state && /^[A-Z]{2}$/.test(state);
}

export interface RecordLicenseResult {
  ok: boolean;
  error?: string;
  licenseId?: string;
  verificationId?: string;
}

/**
 * Validate + record a dealer's claimed license. Creates a DealerLicense (the real
 * record of the claim) and upserts a DealerVerification in the PENDING (unverified)
 * state. Idempotent for the same license number.
 */
export async function recordDealerLicense(
  dealerId: string,
  licenseNumber: string,
  state: string | null
): Promise<RecordLicenseResult> {
  const licenseNum = licenseNumber.trim();
  if (!isValidLicenseFormat(licenseNum)) {
    return { ok: false, error: "License number must be 3–32 alphanumeric characters." };
  }
  if (!isValidStateCode(state)) {
    return { ok: false, error: "A valid 2-letter dealership state is required before recording a license (complete business info first)." };
  }
  const stateCode = state as string;

  // DealerLicense: dedupe on (dealerId, licenseNum) so re-saving is idempotent.
  const existingLicense = await prisma.dealerLicense.findFirst({
    where: { dealerId, licenseNum },
    select: { id: true },
  });
  const license = existingLicense
    ? existingLicense
    : await prisma.dealerLicense.create({
        data: { dealerId, licenseNum, state: stateCode, isActive: true },
        select: { id: true },
      });

  // DealerVerification (unique on dealerId): keep `verified` only if the SAME
  // license number was already verified; any new/changed license is PENDING again.
  const priorVerification = await prisma.dealerVerification.findUnique({ where: { dealerId } });
  const keepVerified = priorVerification?.verified === true && priorVerification.licenseNum === licenseNum;
  const verification = await prisma.dealerVerification.upsert({
    where: { dealerId },
    create: { dealerId, licenseNum, state: stateCode, verified: false },
    update: {
      licenseNum,
      state: stateCode,
      verified: keepVerified,
      ...(keepVerified ? {} : { verifiedAt: null, verifiedBy: null }),
    },
    select: { id: true },
  });

  return { ok: true, licenseId: license.id, verificationId: verification.id };
}

/**
 * Authoritative admin verification (or un-verification) of a dealer's license.
 * This is the ONLY path that may set `verified = true`. Writes an audit trail.
 */
export async function verifyDealerLicense(
  dealerId: string,
  adminId: string,
  adminEmail: string,
  verified: boolean,
  reason: string
): Promise<{ dealerId: string; verified: boolean }> {
  const existing = await prisma.dealerVerification.findUnique({ where: { dealerId } });
  if (!existing) {
    throw new Error("No license on file for this dealer — the dealer must submit a license before it can be verified.");
  }
  await prisma.dealerVerification.update({
    where: { dealerId },
    data: { verified, verifiedBy: verified ? adminId : null, verifiedAt: verified ? new Date() : null },
  });
  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: verified ? "DEALER_LICENSE_VERIFIED" : "DEALER_LICENSE_UNVERIFIED",
      entityType: "DealerVerification",
      entityId: existing.id,
      reason,
      metadata: { dealerId, licenseNum: existing.licenseNum, state: existing.state },
    },
  });
  return { dealerId, verified };
}

export interface DealerVerificationState {
  hasSignature: boolean;
  hasLicenseRecord: boolean;
  hasVerifiedLicense: boolean;
}

/**
 * Snapshot of the verification/agreement records that gate activation. A signature
 * counts whether it came through the in-house flow (DealerAgreementSignature) or
 * the legacy/historical DocuSign marketplace field (marketplaceAgreementSignedAt).
 */
export async function getDealerVerificationState(dealerId: string): Promise<DealerVerificationState> {
  const [dealer, signature, verification] = await Promise.all([
    prisma.dealer.findUnique({ where: { id: dealerId }, select: { marketplaceAgreementSignedAt: true } }),
    prisma.dealerAgreementSignature.findUnique({ where: { dealerId }, select: { id: true } }),
    prisma.dealerVerification.findUnique({ where: { dealerId }, select: { verified: true } }),
  ]);
  return {
    hasSignature: !!signature || !!dealer?.marketplaceAgreementSignedAt,
    hasLicenseRecord: !!verification,
    hasVerifiedLicense: verification?.verified === true,
  };
}

/**
 * Grandfathered ACTIVE dealers that lack a signature and/or a verified license —
 * the admin follow-up list. Read-only; nothing is auto-deactivated.
 */
export async function listLegacyUnverifiedActiveDealers(): Promise<Array<{ id: string; dealershipName: string; missing: string[] }>> {
  const active = await prisma.dealer.findMany({
    where: { status: "ACTIVE", isSystemPlaceholder: false },
    select: { id: true, dealershipName: true },
  });
  const out: Array<{ id: string; dealershipName: string; missing: string[] }> = [];
  for (const d of active) {
    const state = await getDealerVerificationState(d.id);
    const missing: string[] = [];
    if (!state.hasSignature) missing.push("agreement_signature");
    if (!state.hasVerifiedLicense) missing.push("verified_license");
    if (missing.length > 0) out.push({ id: d.id, dealershipName: d.dealershipName, missing });
  }
  return out;
}
