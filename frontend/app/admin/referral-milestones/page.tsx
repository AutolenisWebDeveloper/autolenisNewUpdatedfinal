import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { DollarSign } from "lucide-react";
import MilestonePayActionClient from "@/components/admin/MilestonePayActionClient";
import ReferralMilestoneConfigManager from "@/components/admin/ReferralMilestoneConfigManager";

export const dynamic = "force-dynamic";

export default async function AdminReferralMilestonesPage() {
  const admin = await requireAdmin();
  const [milestones, configs] = await Promise.all([
    prisma.referralMilestone.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.referralMilestoneConfig.findMany({ orderBy: { threshold: "asc" } }),
  ]);

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="admin-referral-milestones-page">
      <div className="flex items-center gap-3 mb-6">
        <DollarSign size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Referral Milestones</h1>
      </div>

      <ReferralMilestoneConfigManager initialConfigs={configs} />

      <h2 className="text-sm font-bold text-slate-900 mb-3">Earned milestones ({milestones.length})</h2>
      <div className="space-y-2">
        {milestones.length === 0 ? (
          <p className="text-slate-400 text-sm">No milestones earned yet</p>
        ) : (
          milestones.map(m => (
            <div key={m.id} data-testid={`milestone-${m.id}`} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4">
              <div>
                <p className="font-semibold text-slate-900 text-sm">{m.milestone.replace(/_/g, " ")}</p>
                <p className="text-xs text-slate-400">Reward: ${(m.rewardValue / 100).toLocaleString()} · {m.achievedAt?.toLocaleDateString() ?? "Pending"}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={m.achieved ? "green" : "secondary"} className="text-xs">{m.achieved ? "Earned" : "Pending"}</Badge>
                {m.achieved && !m.paidAt && <MilestonePayActionClient milestoneId={m.id} milestoneLabel={m.milestone.replace(/_/g, " ")} rewardValueCents={m.rewardValue} adminRole={admin.role} />}
                {m.paidAt && <Badge variant="green" className="text-xs">Paid {m.paidAt.toLocaleDateString()}</Badge>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
