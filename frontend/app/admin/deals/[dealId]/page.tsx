// /admin/deals/[dealId] — Full deal detail with tabs, timeline, and admin action panel
// Tabs: Overview | Billing | Insurance | E-Sign | Pickup | Refunds
// All actions logged to AdminAuditLog with actor, timestamp, reason

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { PREMIUM_FEE_CENTS } from "@/lib/constants";
import AdminDealTabs from "@/components/admin/AdminDealTabs";
import { LEGACY_ENVELOPE_SELECT } from "@/lib/services/esign/esign-schema-gate";
import { PICKUP_SAFE_SELECT } from "@/lib/services/pickup/pickup-select";

export const dynamic = "force-dynamic";
interface Props { params: Promise<{ dealId: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { dealId } = await params;
  return { title: `Deal ${dealId.slice(-8)} — Admin` };
}

export default async function AdminDealDetailPage({ params }: Props) {
  const { dealId } = await params;
  const admin = await requireAdmin();

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      buyer: { include: { user: true } },
      offer: { include: { dealer: { include: { user: true } }, auction: { include: { deposit: true } } } },
      contractScans: { orderBy: { scannedAt: "desc" } },
      eSignEnvelopes: { select: LEGACY_ENVELOPE_SELECT },
      // PROJECTED: this row is handed to AdminDealTabs via
      // `deal={JSON.parse(JSON.stringify(deal))}`, which puts every column in the RSC payload the
      // browser receives. `pickup: true` would ship `token_hash` with it.
      pickup: { select: PICKUP_SAFE_SELECT },
    },
  });
  if (!deal) notFound();

  // Compute deal timeline from timestamps
  const timeline = buildDealTimeline(deal)
    .filter((item): item is { stage: string; timestamp: Date; description: string } => item !== null)
    .map(item => ({ ...item, timestamp: item.timestamp.toISOString() }));

  // Audit log for this deal
  const auditLogs = await prisma.adminAuditLog.findMany({
    where: { entityType: "Deal", entityId: dealId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="admin-deal-detail-page">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Deal #{dealId.slice(-8)}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {deal.buyer.firstName} {deal.buyer.lastName}
            {deal.offer && <> · ${(deal.offer.otdPriceCents / 100).toLocaleString()}</>}
          </p>
        </div>
        <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${getDealStatusStyle(deal.status)}`}>
          {deal.status.replace(/_/g, " ")}
        </div>
      </div>

      {/* Tabs + action panel (client component) */}
      <AdminDealTabs
        deal={JSON.parse(JSON.stringify(deal))}
        timeline={timeline}
        auditLogs={JSON.parse(JSON.stringify(auditLogs))}
        adminId={admin.adminId}
        adminEmail={admin.email}
        adminRole={admin.role}
      />
    </div>
  );
}

function getDealStatusStyle(status: string): string {
  if (status === "COMPLETED") return "bg-green-50 text-green-700 border-green-200";
  if (status === "CANCELLED" || status === "REFUNDED") return "bg-red-50 text-red-700 border-red-200";
  return "bg-blue-50 text-blue-700 border-blue-200";
}

type DealForTimeline = {
  createdAt: Date;
  updatedAt: Date;
  financingPath: string | null;
  feePaidAt: Date | null;
  feeAmountCents: number | null;
  insuranceStatus: string;
  contractShieldStatus: string | null;
  contractShieldScore: number | null;
  eSignEnvelopes: { sentAt: Date | null; completedAt: Date | null; signerKind: string }[];
  pickup: { scheduledAt: Date | null; completedAt: Date | null } | null;
};

function buildDealTimeline(deal: DealForTimeline) {
  const stages = [
    { stage: "DEAL CREATED", timestamp: deal.createdAt, description: "Buyer selected the winning offer" },
    deal.financingPath ? { stage: "FINANCING SELECTED", timestamp: deal.updatedAt, description: `Path: ${deal.financingPath}` } : null,
    deal.feePaidAt ? { stage: "FEE PAID", timestamp: deal.feePaidAt, description: `$${(deal.feeAmountCents ?? PREMIUM_FEE_CENTS) / 100} concierge fee paid` } : null,
    deal.insuranceStatus !== "NOT_STARTED" ? { stage: "INSURANCE", timestamp: deal.updatedAt, description: `Status: ${deal.insuranceStatus.replace(/_/g, " ")}` } : null,
    deal.contractShieldStatus ? { stage: `CONTRACT SHIELD: ${deal.contractShieldStatus}`, timestamp: deal.updatedAt, description: `Score: ${deal.contractShieldScore}` } : null,
    // §13-D30. One pair of events PER SIGNER. A single "SIGNED" row was accurate while a deal
    // held one envelope; with a co-buyer it would report the deal signed at the moment the first
    // signer finished, which is the exact misreading the cutover was written to prevent.
    ...deal.eSignEnvelopes.flatMap((e) => {
      const who = e.signerKind === "CO_BUYER" ? "co-buyer" : "buyer";
      return [
        e.sentAt ? { stage: `SENT FOR SIGNING (${who})`, timestamp: e.sentAt, description: `Signing envelope sent to ${who}` } : null,
        e.completedAt ? { stage: `SIGNED (${who})`, timestamp: e.completedAt, description: `Contract signed by ${who}` } : null,
      ];
    }),
    deal.pickup?.scheduledAt ? { stage: "PICKUP SCHEDULED", timestamp: deal.pickup.scheduledAt, description: "Vehicle pickup scheduled" } : null,
    deal.pickup?.completedAt ? { stage: "PICKUP COMPLETE", timestamp: deal.pickup.completedAt, description: "Vehicle delivered to buyer" } : null,
  ].filter(Boolean);

  return stages;
}
