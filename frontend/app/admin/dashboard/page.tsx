import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { ADMIN_ROLE_LABELS } from "@/lib/admin-auth";
import Link from "next/link";
import {
  AlertOctagon, Users, Gavel, FileText, TrendingUp, Activity,
  DollarSign, Shield, Share2, PenLine, Brain, Building2,
  ChevronRight, AlertTriangle, ClipboardList, MessageSquare, BookOpen, Inbox,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const admin = await requireAdmin();

  const [adminRecord, buyerCount, dealerCount, activeAuctions, activeDeals, pendingContracts, recentActivity] = await Promise.all([
    prisma.admin.findUnique({ where: { id: admin.adminId } }),
    prisma.buyer.count(),
    prisma.dealer.count({ where: { status: "ACTIVE" } }),
    prisma.auction.count({ where: { status: "ACTIVE" } }),
    prisma.deal.count({ where: { status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] } } }),
    prisma.contractScan.count({ where: { status: "FAIL" } }),
    prisma.buyerActivityEvent.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
  ]);

  const codesRemaining = adminRecord?.recoveryCodes.length ?? 0;
  const usedFinalCode = codesRemaining === 0 && adminRecord?.lastRecoveryCodeUsedAt != null;
  const lowCodes = codesRemaining > 0 && codesRemaining <= 2;

  const roleLabel = ADMIN_ROLE_LABELS[admin.role] ?? admin.role;

  return (
    <div className="min-h-screen bg-[#F4F6FA] p-6 md:p-8 max-w-[1400px] mx-auto" data-testid="admin-dashboard">
      <header className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-2 h-2 rounded-full bg-[#059669] animate-pulse" />
            <p className="text-[10px] text-[#94A3B8] font-semibold uppercase tracking-widest">
              Live Platform
            </p>
          </div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">
            Command Center
          </h1>
          <p className="text-sm text-[#94A3B8] mt-0.5">
            {roleLabel} &middot; {admin.email}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/system-health"
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#E2E8F0] rounded-xl text-xs text-[#475569] hover:border-[#BFDBFE] hover:text-[#0B5FD1] transition-all shadow-sm font-medium">
            <Activity size={11} />System
          </Link>
          <Link href="/admin/queues" data-testid="open-queues-btn"
            className="flex items-center gap-1.5 px-4 py-2 bg-[#0B5FD1] rounded-xl text-xs font-semibold text-white hover:bg-[#0A4DB8] transition-colors shadow-md shadow-[#0B5FD1]/20">
            <AlertOctagon size={11} />View Queues
          </Link>
        </div>
      </header>

      {usedFinalCode && (
        <div
          className="flex items-start gap-4 bg-white border border-[#FECACA] rounded-2xl p-4 mb-6 shadow-sm"
          data-testid="admin-mfa-final-code-banner"
        >
          <AlertTriangle size={20} className="text-[#DC2626] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-[#991B1B] text-sm">⚠ CRITICAL: You logged in using your final recovery code.</p>
            <p className="text-[#B91C1C] text-sm mt-0.5">Reset your authenticator now and generate new recovery codes immediately.</p>
          </div>
          <Link href="/admin/security/mfa"
            className="shrink-0 px-3 py-2 bg-[#DC2626] rounded-xl text-xs font-semibold text-white hover:bg-[#B91C1C] transition-colors">
            Reset MFA Now →
          </Link>
        </div>
      )}
      {!usedFinalCode && lowCodes && (
        <div
          className="flex items-start gap-4 bg-white border border-[#FED7AA] rounded-2xl p-4 mb-6 shadow-sm"
          data-testid="admin-mfa-low-codes-banner"
        >
          <AlertTriangle size={20} className="text-[#D97706] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-[#92400E] text-sm">⚠ WARNING: You are almost out of recovery codes. {codesRemaining} code(s) remaining.</p>
          </div>
          <Link href="/admin/security/mfa" className="shrink-0 text-sm font-semibold text-[#D97706] hover:text-[#B45309] transition-colors">
            Manage MFA →
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        {[
          {
            label: "Total Buyers", value: buyerCount,
            icon: Users, href: "/admin/buyers",
            iconBg: "bg-[#EFF6FF]", iconColor: "text-[#0B5FD1]",
            slug: "total-buyers",
          },
          {
            label: "Active Dealers", value: dealerCount,
            icon: Building2, href: "/admin/dealers",
            iconBg: "bg-[#ECFDF5]", iconColor: "text-[#059669]",
            slug: "active-dealers",
          },
          {
            label: "Live Auctions", value: activeAuctions,
            icon: Gavel, href: "/admin/auctions",
            iconBg: "bg-[#FFFBEB]", iconColor: "text-[#D97706]",
            slug: "live-auctions",
          },
          {
            label: "Active Deals", value: activeDeals,
            icon: FileText, href: "/admin/deals",
            iconBg: "bg-[#EEF2FF]", iconColor: "text-[#4F46E5]",
            slug: "active-deals",
          },
          {
            label: "Shield Alerts", value: pendingContracts,
            icon: AlertOctagon, href: "/admin/contract-shield",
            iconBg: pendingContracts > 0 ? "bg-[#FEF2F2]" : "bg-[#ECFDF5]",
            iconColor: pendingContracts > 0 ? "text-[#DC2626]" : "text-[#059669]",
            slug: "contract-fails",
          },
        ].map(stat => (
          <Link
            key={stat.label}
            href={stat.href}
            data-testid={`admin-stat-${stat.slug}`}
            className="bg-white border border-[#E2E8F0] rounded-2xl p-5 hover:border-[#BFDBFE] hover:shadow-md hover:shadow-[#0B5FD1]/5 transition-all group"
          >
            <div className="flex items-start justify-between mb-4">
              <div className={`w-9 h-9 rounded-xl ${stat.iconBg} flex items-center justify-center`}>
                <stat.icon size={15} className={stat.iconColor} />
              </div>
              <ChevronRight size={13}
                className="text-[#CBD5E1] group-hover:text-[#0B5FD1] transition-colors mt-0.5" />
            </div>
            <p className="text-3xl font-bold text-[#0F172A] font-mono tracking-tight mb-1">
              {stat.value.toLocaleString("en-US")}
            </p>
            <p className="text-xs text-[#94A3B8] font-medium">{stat.label}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <section>
            <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em] mb-3">
              Quick Access
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "CRM & Communications", href: "/admin/crm", icon: Inbox, testId: "admin-quicklink-crm" },
                { label: "Queues", href: "/admin/queues", icon: AlertOctagon, testId: "admin-quicklink-exception-queues" },
                { label: "Activity", href: "/admin/activity", icon: Activity, testId: "admin-quicklink-activity-feed" },
                { label: "Finance", href: "/admin/finance", icon: DollarSign },
                { label: "Pipeline", href: "/admin/reports/pipeline", icon: TrendingUp, testId: "admin-quicklink-pipeline" },
                { label: "Deal Risk", href: "/admin/reports/risk", icon: Shield, testId: "admin-quicklink-deal-risk" },
                { label: "Affiliates", href: "/admin/reports/affiliate", icon: Share2, testId: "admin-quicklink-affiliate-report" },
                { label: "E-Sign", href: "/admin/esign", icon: PenLine, testId: "admin-quicklink-e-sign-hub" },
                { label: "AI Console", href: "/admin/ai", icon: Brain },
                { label: "System 4C", href: "/admin/requests", icon: ClipboardList, testId: "admin-quicklink-system-4c" },
                { label: "Faith Content", href: "/admin/faith-content", icon: BookOpen, testId: "admin-quicklink-faith-content" },
                { label: "Dealer Health", href: "/admin/dealers/health", icon: Building2, testId: "admin-quicklink-dealer-health" },
                { label: "Messages", href: "/admin/messages", icon: MessageSquare, testId: "admin-quicklink-messages" },
              ].map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  data-testid={item.testId ?? `admin-quicklink-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                  className="flex flex-col items-center gap-2 p-4 bg-white border border-[#E2E8F0] rounded-2xl hover:border-[#BFDBFE] hover:bg-[#EFF6FF]/40 hover:shadow-sm transition-all group"
                >
                  <item.icon size={16}
                    className="text-[#94A3B8] group-hover:text-[#0B5FD1] transition-colors" />
                  <span className="text-[10px] font-semibold text-[#94A3B8] group-hover:text-[#0F172A] transition-colors text-center">
                    {item.label}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section data-testid="admin-recent-activity">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em]">
                Recent Platform Activity
              </p>
              <Link href="/admin/activity" data-testid="view-all-activity-link"
                className="text-[10px] text-[#0B5FD1] hover:text-[#0A4DB8] font-semibold transition-colors">
                View all →
              </Link>
            </div>
            <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-sm">
              {recentActivity.length === 0 ? (
                <p className="px-6 py-10 text-sm text-[#94A3B8] text-center">
                  No recent activity.
                </p>
              ) : (
                <div className="divide-y divide-[#F1F5F9]">
                  {recentActivity.map(event => (
                    <div
                      key={event.id}
                      data-testid={`activity-item-${event.id}`}
                      className="flex items-center justify-between px-6 py-3.5 hover:bg-[#F8FAFF] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#0B5FD1] shrink-0" />
                        <p className="text-sm text-[#374151]">{event.title}</p>
                      </div>
                      <p className="text-[10px] text-[#94A3B8] font-mono shrink-0 ml-4">
                        {event.createdAt.toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                        })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-5">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] border border-[#DBEAFE] flex items-center justify-center">
                <Shield size={16} className="text-[#0B5FD1]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#0F172A] leading-tight">{roleLabel}</p>
                <p className="text-[10px] text-[#94A3B8] font-mono truncate mt-0.5">
                  {admin.email}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-3 border-t border-[#F1F5F9]">
              <div className="w-1.5 h-1.5 rounded-full bg-[#059669] animate-pulse" />
              <p className="text-[10px] text-[#94A3B8] font-medium">
                Session active · MFA verified
              </p>
            </div>
          </div>

          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
            <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em] mb-4">
              Platform Vitals
            </p>
            <div className="space-y-3">
              {[
                { label: "Live Auctions", value: activeAuctions, dot: "bg-[#D97706]", href: "/admin/auctions" },
                { label: "Active Deals", value: activeDeals, dot: "bg-[#4F46E5]", href: "/admin/deals" },
                {
                  label: "Shield Alerts", value: pendingContracts,
                  dot: pendingContracts > 0 ? "bg-[#DC2626]" : "bg-[#059669]",
                  href: "/admin/contract-shield",
                },
              ].map(item => (
                <Link key={item.label} href={item.href}
                  className="flex items-center justify-between group">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${item.dot} shrink-0`} />
                    <span className="text-xs text-[#94A3B8] group-hover:text-[#0F172A] transition-colors">
                      {item.label}
                    </span>
                  </div>
                  <span className="text-xs font-bold font-mono text-[#0F172A]">
                    {item.value}
                  </span>
                </Link>
              ))}
            </div>
          </div>

          <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-sm">
            <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em] px-5 pt-5 pb-3">
              Operations
            </p>
            <div className="divide-y divide-[#F1F5F9]">
              {[
                { label: "Exception Queues", href: "/admin/queues" },
                { label: "Ops Dashboard", href: "/admin/ops-dashboard", testId: "admin-quicklink-ops-dashboard" },
                { label: "Request a Car (4C)", href: "/admin/requests" },
                { label: "Referral Milestones", href: "/admin/referral-milestones" },
              ].map(item => (
                <Link key={item.href} href={item.href} data-testid={item.testId}
                  className="flex items-center justify-between px-5 py-3 text-xs text-[#475569] hover:bg-[#F8FAFF] hover:text-[#0B5FD1] transition-colors">
                  {item.label}
                  <ChevronRight size={12} className="text-[#CBD5E1]" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
