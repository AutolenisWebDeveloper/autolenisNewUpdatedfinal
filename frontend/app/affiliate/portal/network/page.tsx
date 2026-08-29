// Feature 8 — Affiliate Income Planner + Referral Network Tree (L1/L2/L3 visual)
// Commission rates sourced from COMMISSION_RATES in lib/constants.ts — never hardcoded

import { requireAffiliateWithOnboarding } from "@/lib/auth/affiliate-session";
import { getNetworkSize } from "@/lib/services/affiliate/commission.service";
import { COMMISSION_RATES, PREMIUM_FEE_REMAINING_CENTS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { GitBranch, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/ui/patterns/EmptyState";

export const dynamic = "force-dynamic";

export default async function AffiliateNetworkPage() {
  // P1-2 — gate runs in the PAGE, not only the layout: App Router does not
  // re-render the layout on soft navigation, so a sidebar click would bypass
  // a layout-only gate.
  const { affiliate } = await requireAffiliateWithOnboarding();
  const network = await getNetworkSize(affiliate.id);

  // Build L1 tree data
  const l1Members = await prisma.affiliate.findMany({
    where: { parentId: affiliate.id },
    include: {
      user: { select: { email: true } },
      children: {
        include: { user: { select: { email: true } }, children: { include: { user: { select: { email: true } } } } },
        take: 100,
      },
    },
    take: 20,
  });

  // Earnings per level — from COMMISSION_RATES (lib/constants.ts) only
  const L1_PER_DEAL = Math.round(PREMIUM_FEE_REMAINING_CENTS * COMMISSION_RATES.LEVEL_1);
  const L2_PER_DEAL = Math.round(PREMIUM_FEE_REMAINING_CENTS * COMMISSION_RATES.LEVEL_2);
  const L3_PER_DEAL = Math.round(PREMIUM_FEE_REMAINING_CENTS * COMMISSION_RATES.LEVEL_3);

  function maskEmail(email: string): string {
    const [user, domain] = email.split("@");
    return `${user.slice(0, 2)}***@${domain}`;
  }

  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="affiliate-network-page">
      <div className="flex items-center gap-3 mb-6">
        <GitBranch size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Referral Network</h1>
      </div>

      {/* Network summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {[
          { level: "L1 (Direct)", count: network.l1, earnsPer: L1_PER_DEAL, pct: `${Math.round(COMMISSION_RATES.LEVEL_1 * 100)}%` },
          { level: "L2",          count: network.l2, earnsPer: L2_PER_DEAL, pct: `${Math.round(COMMISSION_RATES.LEVEL_2 * 100)}%` },
          { level: "L3",          count: network.l3, earnsPer: L3_PER_DEAL, pct: `${Math.round(COMMISSION_RATES.LEVEL_3 * 100)}%` },
        ].map(t => (
          <div key={t.level} data-testid={`network-tier-${t.level.toLowerCase().split(" ")[0]}`}
            className="bg-white border border-slate-200 rounded-xl p-5 text-center">
            <Badge variant="secondary" className="mb-2">{t.pct}</Badge>
            <p className="text-3xl font-bold text-al-primary">{t.count}</p>
            <p className="text-xs text-slate-500 mt-0.5">{t.level} members</p>
            <p className="text-xs text-green-600 mt-1">${(t.earnsPer / 100).toFixed(2)}/deal</p>
          </div>
        ))}
      </div>

      {/* Visual tree */}
      {l1Members.length === 0 ? (
        <EmptyState
          testId="empty-network"
          icon={GitBranch}
          title="Your network is empty"
          body="Share your referral link to start earning from L1, L2, and L3 commissions."
          action={{ label: "Open referral hub", href: "/affiliate/portal/referral-hub", testId: "empty-network-cta" }}
          className="py-16 bg-white border border-slate-200 rounded-xl"
        />
      ) : (
        <div className="space-y-3" data-testid="network-tree">
          {/* Root node — you */}
          <div className="flex items-center gap-3 bg-al-primary text-white rounded-xl px-5 py-4" data-testid="network-root-node">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <User size={16} />
            </div>
            <div>
              <p className="font-semibold text-sm">You</p>
              <p className="text-xs text-white/60">Root affiliate</p>
            </div>
          </div>

          {/* L1 nodes */}
          {l1Members.map((l1, i) => (
            <div key={l1.id} className="ml-2 sm:ml-8 border-l-2 border-al-primary/20 pl-3 sm:pl-5 space-y-2" data-testid={`l1-member-${i}`}>
              <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
                <div className="w-7 h-7 rounded-full bg-al-primary/10 flex items-center justify-center">
                  <User size={13} className="text-al-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-800">{maskEmail(l1.user.email)}</p>
                  <p className="text-xs text-slate-500">L1 · {l1.children.length} referrals</p>
                </div>
                <Badge variant="blue" className="ml-auto text-xs">${(L1_PER_DEAL / 100).toFixed(2)}</Badge>
              </div>

              {/* L2 nodes — show up to 3, then a "+N more" count */}
              {l1.children.slice(0, 3).map((l2, j) => (
                <div key={l2.id} className="ml-2 sm:ml-8 border-l-2 border-slate-200 pl-2.5 sm:pl-4 space-y-1.5" data-testid={`l2-member-${i}-${j}`}>
                  <div className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-lg px-4 py-2.5">
                    <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center">
                      <User size={12} className="text-slate-500" />
                    </div>
                    <p className="text-xs text-slate-600">{maskEmail(l2.user.email)}</p>
                    <Badge variant="secondary" className="ml-auto text-xs">${(L2_PER_DEAL / 100).toFixed(2)}</Badge>
                  </div>

                  {/* L3 nodes — show up to 2, then a "+N more" count */}
                  {l2.children.slice(0, 2).map((l3, k) => (
                    <div key={l3.id} className="ml-2 sm:ml-6 border-l-2 border-slate-100 pl-2 sm:pl-3" data-testid={`l3-member-${i}-${j}-${k}`}>
                      <div className="flex items-center gap-2 bg-white border border-slate-100 rounded-lg px-3 py-2">
                        <User size={11} className="text-slate-300 shrink-0" />
                        <p className="text-xs text-slate-500">{maskEmail(l3.user.email)}</p>
                        <Badge variant="gray" className="ml-auto text-xs">${(L3_PER_DEAL / 100).toFixed(2)}</Badge>
                      </div>
                    </div>
                  ))}
                  {l2.children.length > 2 && (
                    <p className="ml-2 sm:ml-6 pl-2 sm:pl-3 text-xs text-slate-500" data-testid={`l3-more-${i}-${j}`}>
                      +{l2.children.length - 2} more L3 member{l2.children.length - 2 !== 1 ? "s" : ""}
                    </p>
                  )}
                </div>
              ))}
              {l1.children.length > 3 && (
                <p className="ml-2 sm:ml-8 pl-2.5 sm:pl-4 text-xs text-slate-500" data-testid={`l2-more-${i}`}>
                  +{l1.children.length - 3} more L2 member{l1.children.length - 3 !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500 mt-6 text-center">
        Network depth: maximum 3 levels. No L4 or L5 commissions exist.
      </p>
    </div>
  );
}
