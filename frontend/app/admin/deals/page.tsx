import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { DealStatus } from "@prisma/client";
import { dealStatusLabel, dealStatusTone } from "@/lib/domain/status-labels";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { FileText, PenLine, MapPin, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

interface Props { searchParams: Promise<{ status?: string; page?: string }> }

const PAGE_SIZE = 50;

export default async function AdminDealsPage({ searchParams }: Props) {
  await requireAdmin();

  const sp = await searchParams;
  const status = (sp.status?.toUpperCase() ?? "ALL").trim();
  const statusFilter: DealStatus | undefined =
    status !== "ALL" && (Object.values(DealStatus) as string[]).includes(status)
      ? (status as DealStatus)
      : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  let deals: Awaited<ReturnType<typeof prisma.deal.findMany<{ include: { buyer: true; offer: { include: { dealer: { select: { dealershipName: true } } } } } }>>> = [];
  let totalCount = 0;
  let loadError: string | null = null;

  const where = statusFilter ? { status: statusFilter } : undefined;
  try {
    // Count the full result set so the header total is accurate and pagination
    // is possible — previously the page took 50 and showed deals.length as the
    // "total", silently hiding every deal past the first 50.
    [totalCount, deals] = await Promise.all([
      prisma.deal.count({ where }),
      prisma.deal.findMany({
        where,
        include: { buyer: true, offer: { include: { dealer: { select: { dealershipName: true } } } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error loading deals";
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", status);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/deals?${qs}` : "/admin/deals";
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-deals-page">
      <div className="flex items-center gap-3 mb-6"><FileText size={22} className="text-al-primary" /><h1 className="text-xl font-bold text-slate-900">Deals <span className="text-slate-400 font-normal text-sm">({totalCount})</span></h1></div>

      {/* Status filter */}
      <form method="GET" className="flex items-center gap-2 mb-5" data-testid="deal-status-filter">
        <label htmlFor="deal-status" className="text-xs text-slate-500 font-medium">Filter by status</label>
        <select id="deal-status" name="status" defaultValue={status}
          className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700">
          <option value="ALL">All</option>
          {Object.values(DealStatus).map(s => (
            <option key={s} value={s}>{dealStatusLabel(s)}</option>
          ))}
        </select>
        <button type="submit" className="text-xs font-medium px-3 py-1.5 rounded-lg bg-al-primary text-white" data-testid="deal-filter-apply">
          Apply
        </button>
      </form>

      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 flex items-start gap-2 text-red-700" data-testid="deals-load-error">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-sm">Failed to load deals</p>
            <p className="text-xs mt-0.5 font-mono">{loadError}</p>
          </div>
        </div>
      )}
      {!loadError && deals.length === 0 && (
        <div className="text-center py-12 text-slate-400" data-testid="no-deals">
          {statusFilter ? `No deals in "${dealStatusLabel(statusFilter)}" status.` : "No deals found"}
        </div>
      )}
      <div className="space-y-2">
        {deals.map(d => (
          <div key={d.id} data-testid={`deal-row-${d.id}`}
            className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4 hover:border-al-primary/30 transition-colors">
            <Link href={`/admin/deals/${d.id}`} className="flex-1 min-w-0" data-testid={`deal-link-${d.id}`}>
              <p className="font-semibold text-slate-900 text-sm">{d.buyer?.firstName ?? ""} {d.buyer?.lastName ?? ""} — {d.offer?.dealer?.dealershipName ?? "Unknown Dealer"}</p>
              <p className="text-xs text-slate-400">${((d.offer?.otdPriceCents ?? 0) / 100).toLocaleString()} · {d.createdAt.toLocaleDateString()}</p>
            </Link>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant={dealStatusTone(d.status) === "success" ? "green" : dealStatusTone(d.status) === "danger" ? "destructive" : "blue"} className="text-xs">{dealStatusLabel(d.status)}</Badge>
              <Link href={`/admin/deals/${d.id}/esign`} aria-label="E-signature" title="E-signature" className="p-1.5 text-slate-400 hover:text-al-primary" data-testid={`deal-esign-${d.id}`}><PenLine size={14} /></Link>
              <Link href={`/admin/deals/${d.id}/pickup`} aria-label="Pickup" title="Pickup" className="p-1.5 text-slate-400 hover:text-al-primary" data-testid={`deal-pickup-${d.id}`}><MapPin size={14} /></Link>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination — preserves the active status filter. */}
      {totalPages > 1 && (
        <nav className="flex items-center justify-between mt-6" aria-label="Deals pagination" data-testid="deals-pagination">
          <span className="text-xs text-slate-500">
            Page {page} of {totalPages} · {totalCount.toLocaleString()} deal{totalCount === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Link href={buildHref(page - 1)} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-al-primary/40" data-testid="deals-prev">
                ← Prev
              </Link>
            ) : (
              <span className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-100 bg-slate-50 text-slate-300" aria-disabled="true">← Prev</span>
            )}
            {page < totalPages ? (
              <Link href={buildHref(page + 1)} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-al-primary/40" data-testid="deals-next">
                Next →
              </Link>
            ) : (
              <span className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-100 bg-slate-50 text-slate-300" aria-disabled="true">Next →</span>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
