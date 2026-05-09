// /admin/notifications — Admin's own activity inbox (audit log + system alerts)
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Bell, Activity, Briefcase } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Notifications — Admin",
};

function fmtRelative(d: Date) {
  const diffMs = Date.now() - new Date(d).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ActionBadge({ action }: { action: string }) {
  const isStatus = action === "STATUS_CHANGE";
  const isCancel = action === "CANCEL" || action.includes("REJECTED");
  const isApprove = action.includes("APPROVED") || action === "STAGE_ADVANCE";
  const cls = isCancel
    ? "bg-red-50 text-red-700 border-red-200"
    : isApprove
    ? "bg-green-50 text-green-700 border-green-200"
    : isStatus
    ? "bg-blue-50 text-blue-700 border-blue-200"
    : "bg-slate-50 text-slate-600 border-slate-200";
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold border ${cls}`}>
      {action.replace(/_/g, " ")}
    </span>
  );
}

export default async function AdminNotificationsPage() {
  const admin = await requireAdmin();

  const [myAuditLogs, recentPlatformLogs, pendingApplications, ofacFlagged] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where: { adminId: admin.adminId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.adminAuditLog.findMany({
      where: { adminId: { not: admin.adminId } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.dealerApplication.count({ where: { status: "PENDING" } }),
    prisma.preQualification.count({
      where: { decision: { in: ["MANUAL_REVIEW", "OFAC_ESCALATED", "OFAC_REVIEW"] } },
    }),
  ]);

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-notifications-page">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Bell size={20} className="text-[#0B5FD1]" />
          Notifications
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Your recent admin activity and system alerts
        </p>
      </div>

      {/* System alerts */}
      <section className="mb-6" data-testid="system-alerts-section">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
          System Alerts
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href="/admin/dealers/applications"
            className={`block bg-white border rounded-xl p-4 hover:shadow-sm transition-all ${
              pendingApplications > 0 ? "border-amber-200" : "border-slate-200"
            }`}
            data-testid="alert-pending-applications"
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                  pendingApplications > 0 ? "bg-amber-50" : "bg-slate-50"
                }`}
              >
                <Briefcase
                  size={16}
                  className={pendingApplications > 0 ? "text-amber-600" : "text-slate-400"}
                />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-900">
                  {pendingApplications} dealer application{pendingApplications !== 1 ? "s" : ""}
                </p>
                <p className="text-xs text-slate-500">
                  {pendingApplications > 0 ? "Awaiting your review" : "All caught up"}
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/manual-reviews"
            className={`block bg-white border rounded-xl p-4 hover:shadow-sm transition-all ${
              ofacFlagged > 0 ? "border-red-200" : "border-slate-200"
            }`}
            data-testid="alert-ofac-flagged"
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                  ofacFlagged > 0 ? "bg-red-50" : "bg-slate-50"
                }`}
              >
                <Activity
                  size={16}
                  className={ofacFlagged > 0 ? "text-red-600" : "text-slate-400"}
                />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-900">
                  {ofacFlagged} prequal review{ofacFlagged !== 1 ? "s" : ""}
                </p>
                <p className="text-xs text-slate-500">
                  {ofacFlagged > 0 ? "OFAC + manual decisions" : "All clear"}
                </p>
              </div>
            </div>
          </Link>
        </div>
      </section>

      {/* My recent activity */}
      <section className="mb-6" data-testid="my-activity-section">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Your Recent Activity
        </h2>
        {myAuditLogs.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">
            No actions logged yet.
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {myAuditLogs.map((log, i) => (
              <div
                key={log.id}
                className={`flex items-start gap-3 px-4 py-3 ${
                  i < myAuditLogs.length - 1 ? "border-b border-slate-50" : ""
                } hover:bg-slate-50/60 transition-colors`}
                data-testid={`my-activity-${log.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <ActionBadge action={log.action} />
                    <span className="text-sm text-slate-700">
                      {log.entityType}{" "}
                      <span className="font-mono text-xs text-slate-400">
                        {log.entityId.slice(0, 8)}…
                      </span>
                    </span>
                  </div>
                  {log.reason && (
                    <p className="text-xs text-slate-500 mt-1 truncate">{log.reason}</p>
                  )}
                </div>
                <span className="text-[11px] text-slate-400 whitespace-nowrap">
                  {fmtRelative(log.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Platform-wide activity */}
      <section data-testid="platform-activity-section">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Platform Activity (Other Admins)
        </h2>
        {recentPlatformLogs.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">
            No other admin activity.
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {recentPlatformLogs.map((log, i) => (
              <div
                key={log.id}
                className={`flex items-start gap-3 px-4 py-3 ${
                  i < recentPlatformLogs.length - 1 ? "border-b border-slate-50" : ""
                } hover:bg-slate-50/60 transition-colors`}
                data-testid={`platform-activity-${log.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <ActionBadge action={log.action} />
                    <span className="text-sm text-slate-700">
                      {log.entityType}{" "}
                      <span className="font-mono text-xs text-slate-400">
                        {log.entityId.slice(0, 8)}…
                      </span>
                    </span>
                    <span className="text-xs text-slate-400">by {log.adminEmail}</span>
                  </div>
                  {log.reason && (
                    <p className="text-xs text-slate-500 mt-1 truncate">{log.reason}</p>
                  )}
                </div>
                <span className="text-[11px] text-slate-400 whitespace-nowrap">
                  {fmtRelative(log.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
