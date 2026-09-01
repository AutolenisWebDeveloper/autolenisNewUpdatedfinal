// /admin/settings/rbac-shadow — the RBAC shadow-denial report.
//
// lib/auth/permissions.ts runs in SHADOW mode: RBAC_ENFORCE is unset, so a role
// outside a permission's allow-list is recorded as RBAC_SHADOW_DENY and the
// request PROCEEDS. The module header states that flipping RBAC_ENFORCE=true is
// gated on "the owner's review of the shadow-denial report" — but no such report
// existed, so nothing read those records and the precondition for the flip could
// not be met. This page is that report.
//
// Read-only by construction: it renders audit rows and changes nothing. It does
// not expose a toggle, because flipping enforcement is an operator action taken
// with knowledge of the production role distribution, not a button.
//
// RBAC_SHADOW_DENY = would have been blocked, was allowed (shadow).
// RBAC_DENY        = actually blocked, by the always-enforcing gate on the
//                    high-risk money / e-sign / ops-replay routes.
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageContainer, PageHeader, EmptyState, CARD } from "@/components/ui/patterns";
import { PERMISSION_ROLES } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "RBAC Shadow Report — Admin" };

const ROW_LIMIT = 200;

interface Meta { permission?: string; role?: string; path?: string; method?: string; allowedRoles?: string[] }

export default async function RbacShadowReportPage() {
  await requireAdmin();

  const rows = await prisma.adminAuditLog.findMany({
    where: { entityType: "RBAC", action: { in: ["RBAC_SHADOW_DENY", "RBAC_DENY"] } },
    orderBy: { createdAt: "desc" },
    take: ROW_LIMIT,
  });

  const shadow = rows.filter(r => r.action === "RBAC_SHADOW_DENY");
  const enforced = rows.filter(r => r.action === "RBAC_DENY");

  // What the flip would change: which (role → permission) pairs are being waved
  // through today. Each distinct pair is one workflow that would start failing.
  const impact = new Map<string, { role: string; permission: string; count: number; lastAt: Date; paths: Set<string> }>();
  for (const r of shadow) {
    const m = (r.metadata ?? {}) as Meta;
    const role = m.role ?? "UNKNOWN";
    const permission = m.permission ?? r.entityId;
    const key = `${role}::${permission}`;
    const existing = impact.get(key);
    if (existing) {
      existing.count += 1;
      if (m.path) existing.paths.add(m.path);
    } else {
      impact.set(key, { role, permission, count: 1, lastAt: r.createdAt, paths: new Set(m.path ? [m.path] : []) });
    }
  }
  const impactRows = [...impact.values()].sort((a, b) => b.count - a.count);

  const isEnforcing = process.env.RBAC_ENFORCE === "true";

  return (
    <PageContainer testId="rbac-shadow-report-page">
      <PageHeader
        title="RBAC Shadow Report"
        subtitle="Permission denials that were recorded but ALLOWED, and the denials actually enforced. Read-only."
        eyebrow={
          <Badge variant={isEnforcing ? "green" : "amber"} data-testid="rbac-mode-badge">
            {isEnforcing ? "ENFORCING" : "SHADOW — denials are allowed"}
          </Badge>
        }
      />

      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Would-be denials (allowed)", value: shadow.length, color: "text-amber-600", testId: "stat-shadow" },
          { label: "Enforced denials (blocked)", value: enforced.length, color: "text-green-600", testId: "stat-enforced" },
          { label: "Role → permission pairs", value: impactRows.length, color: "text-slate-700", testId: "stat-pairs" },
        ].map(s => (
          <div key={s.label} data-testid={s.testId} className={`${CARD} p-4 text-center`}>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* What flipping RBAC_ENFORCE=true would break. */}
      <h2 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
        <ShieldAlert size={15} className="text-amber-600" />
        Impact of enabling enforcement
      </h2>
      <p className="text-xs text-slate-500 mb-3">
        Each row is a workflow that succeeds today and would start returning 403 if
        <code className="mx-1 px-1 py-0.5 bg-slate-100 rounded">RBAC_ENFORCE=true</code>.
        An empty table is not proof of safety — it may mean the surface has not been exercised.
      </p>
      {impactRows.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No would-be denials recorded"
          body="No admin has hit a permission outside their role since shadow recording began. This does not by itself clear the flag flip — confirm the surfaces have actually been used."
          testId="no-shadow-denials"
        />
      ) : (
        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm" data-testid="rbac-impact-table">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 pr-4 font-medium">Permission</th>
                <th className="py-2 pr-4 font-medium">Would need</th>
                <th className="py-2 pr-4 font-medium text-right">Times</th>
                <th className="py-2 font-medium">Routes</th>
              </tr>
            </thead>
            <tbody>
              {impactRows.map(r => (
                <tr key={`${r.role}-${r.permission}`} className="border-b border-slate-100 align-top"
                  data-testid={`rbac-impact-${r.role}-${r.permission}`}>
                  <td className="py-2 pr-4"><Badge variant="secondary" className="text-xs">{r.role}</Badge></td>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-700">{r.permission}</td>
                  <td className="py-2 pr-4 text-xs text-slate-500">
                    {(PERMISSION_ROLES as Record<string, readonly string[]>)[r.permission]?.join(", ") ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{r.count}</td>
                  <td className="py-2 text-xs text-slate-400 font-mono break-all">
                    {[...r.paths].slice(0, 3).join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
        <ShieldX size={15} className="text-slate-500" />
        Recent denial records
        <span className="font-normal text-xs text-slate-400">(latest {ROW_LIMIT})</span>
      </h2>
      {rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No denial records" body="Nothing has been recorded yet." testId="no-rbac-rows" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="rbac-rows-table">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-4 font-medium">When</th>
                <th className="py-2 pr-4 font-medium">Outcome</th>
                <th className="py-2 pr-4 font-medium">Admin</th>
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 pr-4 font-medium">Permission</th>
                <th className="py-2 font-medium">Route</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const m = (r.metadata ?? {}) as Meta;
                const blocked = r.action === "RBAC_DENY";
                return (
                  <tr key={r.id} className="border-b border-slate-100" data-testid={`rbac-row-${r.id}`}>
                    <td className="py-2 pr-4 text-xs text-slate-500 whitespace-nowrap">
                      {r.createdAt.toISOString().replace("T", " ").slice(0, 16)}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge variant={blocked ? "green" : "amber"} className="text-xs">
                        {blocked ? "blocked" : "allowed"}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-600 break-all">{r.adminEmail}</td>
                    <td className="py-2 pr-4 text-xs text-slate-600">{m.role ?? "—"}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-700">{m.permission ?? r.entityId}</td>
                    <td className="py-2 text-xs text-slate-400 font-mono break-all">
                      {m.method ? `${m.method} ` : ""}{m.path ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageContainer>
  );
}
