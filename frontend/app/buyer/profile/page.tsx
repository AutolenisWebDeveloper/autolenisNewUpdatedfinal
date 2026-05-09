import type { Metadata } from "next";

export const metadata: Metadata = { title: "Profile" };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { User } from "lucide-react";
import PlanUpgradeCard, { type DepositStatus } from "@/components/buyer/PlanUpgradeCard";
import ProfileEditor from "./ProfileEditor";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const buyer = await requireBuyer();

  const latestDeposit = await prisma.deposit.findFirst({
    where: { buyerId: buyer.id },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });
  const depositStatus: DepositStatus =
    latestDeposit?.status === "PAID" ? "PAID" :
    latestDeposit?.status === "PENDING" ? "PENDING" : "NOT_PAID";

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="profile-page">
      <div className="flex items-center gap-3 mb-6">
        <User size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">My Profile</h1>
      </div>

      <ProfileEditor
        initial={{
          firstName: buyer.firstName,
          lastName: buyer.lastName,
          email: buyer.user.email,
          phone: buyer.phone ?? "",
          address: buyer.address ?? "",
          city: buyer.city ?? "",
          state: buyer.state ?? "",
          zip: buyer.zip ?? "",
        }}
      />

      {/* Plan upgrade card */}
      <div className="mt-6" data-testid="profile-plan-section">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Plan &amp; Billing</h2>
        <PlanUpgradeCard
          plan={buyer.plan as "STANDARD" | "PREMIUM"}
          depositStatus={depositStatus}
          planUpgradedAt={buyer.planUpgradedAt?.toISOString() ?? null}
        />
      </div>
    </div>
  );
}
