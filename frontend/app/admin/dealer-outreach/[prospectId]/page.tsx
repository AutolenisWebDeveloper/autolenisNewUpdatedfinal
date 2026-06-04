// /admin/dealer-outreach/[prospectId] — prospect detail + founder call workspace.
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import ProspectDetailClient, { type ProspectDetail } from "./ProspectDetailClient";

export const dynamic = "force-dynamic";

export default async function DealerProspectDetailPage({
  params,
}: {
  params: Promise<{ prospectId: string }>;
}) {
  await requireAdmin();
  const { prospectId } = await params;

  const prospect = await prisma.dealerProspect.findUnique({
    where: { id: prospectId },
    include: {
      buyerOpp: true,
      outreachLog: {
        where: { channel: "email" },
        orderBy: { sentAt: "desc" },
        take: 1,
      },
    },
  });

  if (!prospect) notFound();

  const opp = prospect.buyerOpp;
  const lastEmail = prospect.outreachLog[0] ?? null;

  const detail: ProspectDetail = {
    id: prospect.id,
    name: prospect.name,
    address: prospect.address,
    city: prospect.city,
    state: prospect.state,
    zip: prospect.zip,
    phone: prospect.phone,
    email: prospect.email,
    website: prospect.website,
    lastOutreach: lastEmail
      ? {
          status: lastEmail.status,
          subject: lastEmail.subject,
          outreachType: lastEmail.outreachType,
          sentAt: lastEmail.sentAt.toISOString(),
        }
      : null,
    brand: prospect.brand,
    sourceUrl: prospect.sourceUrl,
    searchScore: prospect.searchScore,
    status: prospect.status,
    outreachScript: prospect.outreachScript,
    founderNotes: prospect.founderNotes,
    scriptDraftedAt: prospect.scriptDraftedAt?.toISOString() ?? null,
    createdAt: prospect.createdAt.toISOString(),
    scriptedAt: prospect.scriptedAt?.toISOString() ?? null,
    contactedAt: prospect.contactedAt?.toISOString() ?? null,
    repliedAt: prospect.repliedAt?.toISOString() ?? null,
    onboardedAt: prospect.onboardedAt?.toISOString() ?? null,
    deadAt: prospect.deadAt?.toISOString() ?? null,
    deadReason: prospect.deadReason,
    buyerOpp: opp
      ? {
          id: opp.id,
          firstName: opp.firstName,
          make: opp.make,
          model: opp.model,
          trim: opp.trim,
          yearMin: opp.yearMin,
          yearMax: opp.yearMax,
          bodyStyle: opp.bodyStyle,
          budgetAmount: opp.budgetAmount,
          monthlyPayment: opp.monthlyPayment,
          timeline: opp.timeline,
          zip: opp.zip,
          phone: opp.phone,
          createdAt: opp.createdAt.toISOString(),
        }
      : null,
  };

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="admin-dealer-prospect-detail">
      <Link
        href="/admin/dealer-outreach"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"
      >
        <ArrowLeft size={16} /> Back to pipeline
      </Link>
      <ProspectDetailClient prospect={detail} />
    </div>
  );
}
