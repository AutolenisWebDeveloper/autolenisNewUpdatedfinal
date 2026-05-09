import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { prisma } from "@/lib/prisma";
import { AFFILIATE_DISCLOSURE_VERSION } from "@/lib/constants";

// POST /api/affiliate/compliance/acknowledge
// Persists FTC compliance acknowledgment to DB (AffiliateComplianceRecord + Affiliate.ftcAcknowledgedAt).
// Idempotent: re-acknowledging simply updates the timestamp; skips write if already on current version.
export async function POST(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

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

  return successResponse({ acknowledgedAt: now.toISOString(), version: currentVersion });
}
