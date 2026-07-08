import type { Metadata } from "next";

export const metadata: Metadata = { title: "Referral Hub" };

// Feature 25 — Buyer Referral Hub

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Share2, Users, DollarSign } from "lucide-react";
import ReferralLinkCopy from "@/components/buyer/ReferralLinkCopy";
import { evaluateBuyerReferralMilestones } from "@/lib/services/referral/referral-milestone.service";

export const dynamic = "force-dynamic";

export default async function ReferralPage() {
  const buyer = await requireBuyer();
  const affiliate = await prisma.affiliate.findFirst({ where: { userId: buyer.userId } });

  // Referral count + approved-commission sum both depend on the affiliate, so
  // they run together as one concurrent wave.
  const [referralCount, earnedResult] = affiliate
    ? await Promise.all([
        // Count buyers referred via this affiliate's referral code
        prisma.affiliateReferral.count({ where: { affiliateId: affiliate.id } }),
        // Sum approved commissions for this affiliate
        prisma.commission.aggregate({
          where: { affiliateId: affiliate.id, status: "APPROVED" },
          _sum: { amountCents: true },
        }),
      ])
    : [0, null];

  // Award any newly-crossed configured milestones before rendering. Idempotent
  // (unique per buyer+milestone) and best-effort — never blocks the page.
  if (affiliate) await evaluateBuyerReferralMilestones(buyer.id);

  const milestones = await prisma.referralMilestone.findMany({
    where: { buyerId: buyer.id },
    orderBy: { createdAt: "asc" },
  });

  const totalEarnedCents = earnedResult?._sum?.amountCents ?? 0;

  const referralLink = affiliate
    ? `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()}/auth/signup?ref=${affiliate.referralCode}`
    : null;

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="referral-page">
      <div className="flex items-center gap-3 mb-6">
        <Share2 size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Referral Hub</h1>
      </div>

      {referralLink ? (
        <>
          <div className="bg-al-primary-subtle border border-[#BFDBFE] rounded-xl p-5 mb-6">
            <p className="text-sm font-semibold text-slate-800 mb-2">Your referral link</p>
            <ReferralLinkCopy referralLink={referralLink} />
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5 text-center" data-testid="referral-stats-referrals">
              <Users size={20} className="text-al-primary mx-auto mb-2" />
              <p className="text-2xl font-bold text-slate-900">{referralCount}</p>
              <p className="text-xs text-slate-400">Referred buyers</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 text-center" data-testid="referral-stats-earned">
              <DollarSign size={20} className="text-[#059669] mx-auto mb-2" />
              <p className="text-2xl font-bold text-slate-900">
                ${(totalEarnedCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-slate-400">Total earned</p>
            </div>
          </div>

          {milestones.length > 0 && (
            <div data-testid="referral-milestones">
              <h2 className="font-semibold text-slate-800 mb-3 text-sm">Milestones</h2>
              <div className="space-y-2">
                {milestones.map(m => (
                  <div key={m.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-lg p-3" data-testid={`milestone-${m.id}`}>
                    <p className="text-sm text-slate-700">{m.milestone.replace(/_/g, " ")}</p>
                    <Badge variant={m.achieved ? "green" : "secondary"}>{m.achieved ? "Earned" : "Pending"}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-12" data-testid="no-affiliate-account">
          <p className="text-slate-500 text-sm">Referral program available after your first completed deal.</p>
        </div>
      )}
    </div>
  );
}
