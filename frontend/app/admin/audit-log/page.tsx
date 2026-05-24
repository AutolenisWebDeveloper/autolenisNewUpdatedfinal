// /admin/audit-log — standalone, read-only audit log viewer.
// Filterable by actor, action type, entity type, and date range, with a free
// text search on entity id. Offset-paginated (50/page) — never an unbounded
// query. Row expansion (native <details>) reveals before/after state and
// IP/session. No mutation capability exists on this page.
import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ScrollText, ChevronLeft, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audit Log — Admin" };

const PAGE_SIZE = 50;

// Map an entityType to its admin detail route, when one exists.
function entityHref(entityType: string, entityId: string): string | null {
  const map: Record<string, string> = {
    Deal: "/admin/deals", Auction: "/admin/auctions", Buyer: "/admin/buyers",
    Dealer: "/admin/dealers", Affiliate: "/admin/affiliates",
  };
  const base = map[entityType];
  return base ? `${base}/${entityId}` : null;
}

interface SP {
  searchParams: Promise<{
    actor?: string; action?: string; entityType?: string;
    from?: string; to?: string; q?: string; page?: string;
  }>;
}

export default async function AdminAuditLogPage({ searchParams }: SP) {
  await requireAdmin();
  const sp = await searchParams;

  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const actor = sp.actor?.trim() ?? "";
  const action = sp.action?.trim() ?? "";
  const entityType = sp.entityType?.trim() ?? "";
  const q = sp.q?.trim() ?? "";
  const from = sp.from?.trim() ?? "";
  const to = sp.to?.trim() ?? "";

  const where: Prisma.AdminAuditLogWhereInput = {
    ...(actor && { adminEmail: { contains: actor, mode: "insensitive" } }),
    ...(action && { action }),
    ...(entityType && { entityType }),
    ...(q && { entityId: { contains: q, mode: "insensitive" } }),
    ...((from || to) && {
      createdAt: {
        ...(from && { gte: new Date(from) }),
        ...(to && { lte: new Date(`${to}T23:59:59.999Z`) }),
      },
    }),
  };

  const [total, rows, actionGroups, entityGroups] = await Promise.all([
    prisma.adminAuditLog.count({ where }),
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.adminAuditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" }, take: 200 }),
    prisma.adminAuditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" }, take: 100 }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Preserve active filters when building pagination links.
  function pageHref(p: number): string {
    const params = new URLSearchParams();
    if (actor) params.set("actor", actor);
    if (action) params.set("action", action);
    if (entityType) params.set("entityType", entityType);
    if (q) params.set("q", q);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("page", String(p));
    return `/admin/audit-log?${params.toString()}`;
  }

  const humanize = (s: string) => s.replace(/_/g, " ");

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="admin-audit-log-page">
      <div className="flex items-center gap-3 mb-1">
        <ScrollText size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Audit Log <span className="text-slate-400 font-normal text-sm">({total.toLocaleString()})</span></h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">Append-only record of every admin action. Read-only.</p>

      {/* Filters */}
      <form method="GET" className="bg-white border border-slate-200 rounded-xl p-4 mb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end" data-testid="audit-filters">
        <div className="lg:col-span-1">
          <label className="text-xs text-slate-500 font-medium mb-1 block">Actor</label>
          <input name="actor" defaultValue={actor} placeholder="admin email"
            className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2" />
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium mb-1 block">Action</label>
          <select name="action" defaultValue={action} className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white">
            <option value="">All</option>
            {actionGroups.map(a => <option key={a.action} value={a.action}>{humanize(a.action)}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium mb-1 block">Entity</label>
          <select name="entityType" defaultValue={entityType} className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white">
            <option value="">All</option>
            {entityGroups.map(e => <option key={e.entityType} value={e.entityType}>{e.entityType}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium mb-1 block">From</label>
          <input type="date" name="from" defaultValue={from} className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2" />
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium mb-1 block">To</label>
          <input type="date" name="to" defaultValue={to} className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2" />
        </div>
        <div className="flex gap-2">
          <input name="q" defaultValue={q} placeholder="entity id"
            className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2" />
          <button type="submit" className="text-xs font-medium px-3 py-2 rounded-lg bg-[#0B5FD1] text-white shrink-0" data-testid="audit-filter-apply">
            Filter
          </button>
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center" data-testid="audit-empty">
          <ScrollText size={32} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No audit entries match these filters.</p>
        </div>
      ) : (
        <div className="space-y-1.5" data-testid="audit-rows">
          {rows.map(r => {
            const href = entityHref(r.entityType, r.entityId);
            const hasState = (r.previousState != null) || (r.newState != null);
            return (
              <details key={r.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 group" data-testid={`audit-row-${r.id}`}>
                <summary className="flex flex-wrap items-center justify-between gap-2 cursor-pointer list-none">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-mono font-semibold text-slate-700 bg-slate-100 rounded px-2 py-0.5 shrink-0">{humanize(r.action)}</span>
                    <span className="text-xs text-slate-500 truncate">
                      {r.entityType}
                      {href ? <Link href={href} className="text-[#0B5FD1] hover:underline ml-1" onClick={e => e.stopPropagation()}>{r.entityId.slice(0, 8)}</Link> : <span className="ml-1 text-slate-400">{r.entityId.slice(0, 8)}</span>}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-slate-500">{r.adminEmail}</p>
                    <p className="text-xs text-slate-400">{new Date(r.createdAt).toLocaleString()}</p>
                  </div>
                </summary>

                <div className="mt-3 pt-3 border-t border-slate-100 space-y-3 text-xs">
                  {r.reason && <p className="text-slate-600"><span className="font-semibold text-slate-500">Reason:</span> {r.reason}</p>}
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-400">
                    <span>Entity ID: <span className="font-mono text-slate-600">{r.entityId}</span></span>
                    {r.ipAddress && <span>IP: <span className="font-mono text-slate-600">{r.ipAddress}</span></span>}
                    {r.sessionId && <span>Session: <span className="font-mono text-slate-600">{r.sessionId}</span></span>}
                  </div>
                  {r.metadata != null && (
                    <div>
                      <p className="font-semibold text-slate-500 mb-1">Metadata</p>
                      <pre className="bg-slate-50 border border-slate-100 rounded-lg p-2 overflow-x-auto text-slate-700">{JSON.stringify(r.metadata, null, 2)}</pre>
                    </div>
                  )}
                  {hasState && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <p className="font-semibold text-slate-500 mb-1">Previous state</p>
                        <pre className="bg-slate-50 border border-slate-100 rounded-lg p-2 overflow-x-auto text-slate-700">{JSON.stringify(r.previousState ?? {}, null, 2)}</pre>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-500 mb-1">New state</p>
                        <pre className="bg-slate-50 border border-slate-100 rounded-lg p-2 overflow-x-auto text-slate-700">{JSON.stringify(r.newState ?? {}, null, 2)}</pre>
                      </div>
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-5" data-testid="audit-pagination">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="inline-flex items-center gap-1 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 hover:border-[#0B5FD1]/30" data-testid="audit-prev">
              <ChevronLeft size={14} /> Previous
            </Link>
          ) : <span />}
          <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
          {page < totalPages ? (
            <Link href={pageHref(page + 1)} className="inline-flex items-center gap-1 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 hover:border-[#0B5FD1]/30" data-testid="audit-next">
              Next <ChevronRight size={14} />
            </Link>
          ) : <span />}
        </div>
      )}
    </div>
  );
}
