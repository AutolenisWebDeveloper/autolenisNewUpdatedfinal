import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { ADMIN_ROLE_LABELS } from "@/lib/admin-auth";
import Link from "next/link";
import PageContainer from "@/components/ui/patterns/PageContainer";
import PageHeader from "@/components/ui/patterns/PageHeader";
import StatCard from "@/components/ui/patterns/StatCard";
import Panel from "@/components/ui/patterns/Panel";
import EmptyState from "@/components/ui/patterns/EmptyState";
import { CARD, EYEBROW } from "@/components/ui/patterns/tokens";
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
    <PageContainer wide testId="admin-dashboard">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className={EYEBROW}>Live Platform</span>
          </span>
        }
        title="Command Center"
        subtitle={<>{roleLabel} &middot; {admin.email}</>}
        actions={
          <>
            <Link href="/admin/system-health"
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-600 hover:border-al-primary/30 hover:text-al-primary transition-all shadow-sm font-medium">
              <Activity size={12} />System
            </Link>
            <Link href="/admin/queues" data-testid="open-queues-btn"
              className="flex items-center gap-1.5 px-4 py-2 bg-al-primary rounded-xl text-xs font-semibold text-white hover:bg-al-primary-hover transition-colors shadow-md shadow-al-primary/20">
              <AlertOctagon size={12} />View Queues
            </Link>
          </>
        }
      />

      {usedFinalCode && (
        <div
          className="flex items-start gap-4 bg-red-50 border border-red-200 rounded-2xl p-4 mb-6"
          data-testid="admin-mfa-final-code-banner"
        >
          <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
            <AlertTriangle size={17} className="text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-red-900 text-sm">CRITICAL: You logged in using your final recovery code.</p>
            <p className="text-red-700 text-sm mt-0.5">Reset your authenticator now and generate new recovery codes immediately.</p>
          </div>
          <Link href="/admin/security/mfa"
            className="shrink-0 px-3 py-2 bg-red-600 rounded-xl text-xs font-semibold text-white hover:bg-red-700 transition-colors">
            Reset MFA Now →
          </Link>
        </div>
      )}
      {!usedFinalCode && lowCodes && (
        <div
          className="flex items-start gap-4 bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6"
          data-testid="admin-mfa-low-codes-banner"
        >
          <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <AlertTriangle size={17} className="text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-amber-900 text-sm">You are almost out of recovery codes. {codesRemaining} code{codesRemaining === 1 ? "" : "s"} remaining.</p>
          </div>
          <Link href="/admin/security/mfa" className="shrink-0 text-sm font-semibold text-amber-700 hover:text-amber-800 transition-colors">
            Manage MFA →
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        <StatCard
          label="Total Buyers"
          value={buyerCount.toLocaleString("en-US")}
          icon={Users}
          tone="brand"
          href="/admin/buyers"
          testId="admin-stat-total-buyers"
        />
        <StatCard
          label="Active Dealers"
          value={dealerCount.toLocaleString("en-US")}
          icon={Building2}
          tone="success"
          href="/admin/dealers"
          testId="admin-stat-active-dealers"
        />
        <StatCard
          label="Live Auctions"
          value={activeAuctions.toLocaleString("en-US")}
          icon={Gavel}
          tone="warning"
          live={activeAuctions > 0}
          href="/admin/auctions"
          testId="admin-stat-live-auctions"
        />
        <StatCard
          label="Active Deals"
          value={activeDeals.toLocaleString("en-US")}
          icon={FileText}
          tone="indigo"
          href="/admin/deals"
          testId="admin-stat-active-deals"
        />
        <StatCard
          label="Shield Alerts"
          value={pendingContracts.toLocaleString("en-US")}
          sub={pendingContracts > 0 ? "needs review" : "all clear"}
          icon={AlertOctagon}
          tone={pendingContracts > 0 ? "danger" : "success"}
          href="/admin/contract-shield"
          testId="admin-stat-contract-fails"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <section>
            <p className={`${EYEBROW} mb-3`}>Quick Access</p>
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
                  className="flex flex-col items-center gap-2 p-4 bg-white border border-slate-200/80 rounded-2xl hover:border-al-primary/30 hover:bg-al-primary-subtle/40 hover:shadow-sm transition-all group"
                >
                  <item.icon size={16}
                    className="text-slate-400 group-hover:text-al-primary transition-colors" />
                  <span className="text-[10px] font-semibold text-slate-400 group-hover:text-slate-900 transition-colors text-center leading-tight">
                    {item.label}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section data-testid="admin-recent-activity">
            <div className="flex items-center justify-between mb-3">
              <p className={EYEBROW}>Recent Platform Activity</p>
              <Link href="/admin/activity" data-testid="view-all-activity-link"
                className="text-xs text-al-primary hover:text-al-primary-hover font-semibold transition-colors">
                View all →
              </Link>
            </div>
            <div className={`${CARD} overflow-hidden`}>
              {recentActivity.length === 0 ? (
                <EmptyState
                  icon={Activity}
                  title="No recent activity"
                  body="Buyer activity events will stream here as the platform is used."
                />
              ) : (
                <div className="divide-y divide-slate-100">
                  {recentActivity.map(event => (
                    <div
                      key={event.id}
                      data-testid={`activity-item-${event.id}`}
                      className="flex items-center justify-between px-6 py-3.5 hover:bg-slate-50/70 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-1.5 h-1.5 rounded-full bg-al-primary shrink-0" />
                        <p className="text-sm text-slate-700 truncate">{event.title}</p>
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono shrink-0 ml-4">
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
          <div className={`${CARD} p-5`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-al-primary-subtle border border-[#DBEAFE] flex items-center justify-center">
                <Shield size={16} className="text-al-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 leading-tight">{roleLabel}</p>
                <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">
                  {admin.email}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-[11px] text-slate-400 font-medium">
                Session active · MFA verified
              </p>
            </div>
          </div>

          <Panel title="Platform Vitals">
            <div className="space-y-3">
              {[
                { label: "Live Auctions", value: activeAuctions, dot: "bg-amber-500", href: "/admin/auctions" },
                { label: "Active Deals", value: activeDeals, dot: "bg-indigo-500", href: "/admin/deals" },
                {
                  label: "Shield Alerts", value: pendingContracts,
                  dot: pendingContracts > 0 ? "bg-red-500" : "bg-emerald-500",
                  href: "/admin/contract-shield",
                },
              ].map(item => (
                <Link key={item.label} href={item.href}
                  className="flex items-center justify-between group">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${item.dot} shrink-0`} />
                    <span className="text-xs text-slate-500 group-hover:text-slate-900 transition-colors">
                      {item.label}
                    </span>
                  </div>
                  <span className="text-xs font-bold font-mono tabular-nums text-slate-900">
                    {item.value}
                  </span>
                </Link>
              ))}
            </div>
          </Panel>

          <Panel title="Operations" flush>
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {[
                { label: "Exception Queues", href: "/admin/queues" },
                { label: "Ops Dashboard", href: "/admin/ops-dashboard", testId: "admin-quicklink-ops-dashboard" },
                { label: "Request a Car (4C)", href: "/admin/requests" },
                { label: "Referral Milestones", href: "/admin/referral-milestones" },
              ].map(item => (
                <Link key={item.href} href={item.href} data-testid={item.testId}
                  className="flex items-center justify-between px-5 py-3 text-xs text-slate-600 hover:bg-slate-50/70 hover:text-al-primary transition-colors">
                  {item.label}
                  <ChevronRight size={12} className="text-slate-300" />
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </PageContainer>
  );
}
