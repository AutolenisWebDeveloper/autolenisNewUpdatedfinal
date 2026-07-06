import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { AFFILIATE_DISCLOSURE_VERSION } from "@/lib/constants";
import { REQUIRED_DISCLOSURE_IDS } from "@/lib/affiliate/disclosures";
import { logger } from "@/lib/logger";

const schema = z.object({
  acknowledgedDisclosures: z.array(z.string()).max(50),
});

// POST /api/affiliate/compliance/acknowledge
// Persists FTC compliance acknowledgment to DB (AffiliateComplianceRecord + Affiliate.ftcAcknowledgedAt).
// M-19: the submitted disclosure set is validated server-side against the
// canonical list (lib/affiliate/disclosures) — a blanket COMPLIANT flag is no
// longer recordable without every required disclosure — and the exact ids are
// written to the audit trail as evidence of what was shown and accepted.
// Idempotent: re-acknowledging simply updates the timestamp; skips write if already on current version.
export async function POST(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", "Invalid acknowledgment payload", 400);
  }
  const acknowledgedIds = [...new Set(parsed.data.acknowledgedDisclosures)];
  const missing = REQUIRED_DISCLOSURE_IDS.filter((id) => !acknowledgedIds.includes(id));
  if (missing.length > 0) {
    return errorResponse("DISCLOSURES_INCOMPLETE", "All required disclosures must be acknowledged.", 400);
  }

  const now = new Date();

  const forwarded = request.headers.get("x-forwarded-for");
  const ipAddress = forwarded ? forwarded.split(",")[0].trim() : (request.headers.get("x-real-ip") ?? null);
  const userAgent = request.headers.get("user-agent") ?? null;

  const existingRecord = await prisma.affiliateComplianceRecord.findUnique({
    where: { affiliateId: affiliate.id },
    select: { disclosureVersion: true },
  });
  const currentVersion = AFFILIATE_DISCLOSURE_VERSION;
  const alreadyCurrentVersion = existingRecord?.disclosureVersion === currentVersion;
  if (alreadyCurrentVersion) {
    return successResponse({ acknowledgedAt: now.toISOString(), version: currentVersion });
  }

  await prisma.$transaction([
    prisma.affiliateComplianceRecord.upsert({
      where: { affiliateId: affiliate.id },
      create: {
        affiliateId: affiliate.id,
        status: "COMPLIANT",
        acknowledgedAt: now,
        disclosureVersion: currentVersion,
        ipAddress,
        userAgent,
        violations: [],
      },
      update: {
        status: "COMPLIANT",
        acknowledgedAt: now,
        disclosureVersion: currentVersion,
        ipAddress,
        userAgent,
      },
    }),
    prisma.affiliate.update({
      where: { id: affiliate.id },
      data: { ftcAcknowledgedAt: now },
    }),
  ]);

  // Durable evidence of exactly which disclosures were shown and accepted, by
  // whom, from where, on which version (no schema change: the audit log's
  // metadata Json carries the set). Non-blocking — the acknowledgment above
  // has already committed.
  await prisma.adminAuditLog.create({
    data: {
      adminId: "system",
      adminEmail: "system@autolenis.com",
      action: "AFFILIATE_FTC_ACKNOWLEDGED",
      entityType: "AFFILIATE",
      entityId: affiliate.id,
      metadata: {
        disclosureVersion: currentVersion,
        acknowledgedDisclosures: acknowledgedIds,
        ipAddress,
        userAgent,
        acknowledgedAt: now.toISOString(),
      },
    },
  }).catch((err: unknown) => {
    logger.error("[compliance/acknowledge] audit log failed:", err);
  });

  return successResponse({ acknowledgedAt: now.toISOString(), version: currentVersion });
}
