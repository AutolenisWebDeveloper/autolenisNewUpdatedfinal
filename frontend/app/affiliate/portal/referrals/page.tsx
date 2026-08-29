import { requireAffiliate } from "@/lib/auth/affiliate-session";
import { prisma } from "@/lib/prisma";
import { countsTowardEarned } from "@/lib/services/affiliate/commission.service";
import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/ui/patterns/EmptyState";

export const dynamic = "force-dynamic";

export default async function AffiliateReferralsPage() {
  const affiliate = await requireAffiliate();
  const referrals = await prisma.affiliate.findMany({
    where: { parentId: affiliate.id },
    include: { user: { select: { email: true, createdAt: true } }, commissions: { select: { amountCents: true, status: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  function maskEmail(email: string) {
    const [u, d] = email.split("@");
    return `${u.slice(0, 2)}***@${d}`;
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="affiliate-referrals-page">
      <div className="flex items-center gap-3 mb-6">
        <Users size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">My Referrals</h1>
        <Badge variant="secondary">{referrals.length}</Badge>
      </div>
      {referrals.length === 0 ? (
        <EmptyState
          testId="no-referrals"
          icon={Users}
          title="No referrals yet"
          body="Share your link to grow your network — everyone who joins with your code shows up here."
          action={{ label: "Open referral hub", href: "/affiliate/portal/referral-hub", testId: "empty-referrals-cta" }}
          className="py-16 bg-white border border-slate-200 rounded-xl"
        />
      ) : (
        <div className="space-y-2">
          {referrals.map((r, i) => {
            const totalEarned = r.commissions.filter(countsTowardEarned).reduce((s, c) => s + c.amountCents, 0);
            return (
              <div key={r.id} data-testid={`referral-row-${i}`}
                className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-slate-800">{maskEmail(r.user.email)}</p>
                  <p className="text-xs text-slate-500">Joined {r.createdAt.toLocaleDateString()} · {r.commissions.length} deal{r.commissions.length !== 1 ? "s" : ""}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-sm text-green-600">${(totalEarned / 100).toLocaleString()} earned</p>
                  <Badge variant={r.status === "ACTIVE" ? "green" : "secondary"} className="text-xs mt-1">{r.status}</Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
