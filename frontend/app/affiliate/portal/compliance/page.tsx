// /affiliate/portal/compliance — FTC disclosure gate
// Referral link inaccessible until acknowledgment is complete
// Acknowledgment state is persisted to DB (AffiliateComplianceRecord + Affiliate.ftcAcknowledgedAt)
// and pre-populated on every device via server-side fetch.

import "server-only";
import { requireAffiliate } from "@/lib/auth/affiliate-session";
import { prisma } from "@/lib/prisma";
import ComplianceClient from "@/components/affiliate/ComplianceClient";

export const dynamic = "force-dynamic";

export default async function AffiliateCompliancePage() {
  const affiliate = await requireAffiliate();

  const record = await prisma.affiliateComplianceRecord.findUnique({
    where: { affiliateId: affiliate.id },
    select: { acknowledgedAt: true },
  });

  // Pre-populate from DB; fall back to ftcAcknowledgedAt on the affiliate row (set at registration).
  const acknowledgedAt =
    record?.acknowledgedAt?.toISOString() ??
    affiliate.ftcAcknowledgedAt?.toISOString() ??
    null;

  return <ComplianceClient initialAcknowledgedAt={acknowledgedAt} />;
}

