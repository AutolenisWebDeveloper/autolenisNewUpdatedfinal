import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { AuctionStatus } from "@prisma/client";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Gavel, AlertTriangle } from "lucide-react";
import StartAuctionButton from "./StartAuctionButton";

export const dynamic = "force-dynamic";

const STATUS_FILTERS = ["ALL", "PENDING", "ACTIVE", "CLOSED", "EXPIRED", "CANCELLED", "REOPENED"] as const;

interface Props { searchParams: Promise<{ status?: string }> }

export default async function AdminAuctionsPage({ searchParams }: Props) {
  await requireAdmin();

  const sp = await searchParams;
  const status = (sp.status?.toUpperCase() ?? "ALL").trim();
  const statusFilter: AuctionStatus | undefined =
    status !== "ALL" && (STATUS_FILTERS as readonly string[]).includes(status)
      ? (status as AuctionStatus)
      : undefined;

  let auctions: Awaited<ReturnType<typeof prisma.auction.findMany<{ include: { buyer: true; _count: { select: { offers: true; invitations: true } } } }>>> = [];
  let loadError: string | null = null;

  try {
    auctions = await prisma.auction.findMany({
      where: statusFilter ? { status: statusFilter } : undefined,
      include: { buyer: true, _count: { select: { offers: true, invitations: true } } },
      orderBy: { createdAt: "desc" }, take: 50,
    });
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error loading auctions";
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-auctions-page">
      <div className="flex items-center justify-between mb-6 gap-3">
        <div className="flex items-center gap-3">
          <Gavel size={22} className="text-al-primary" />
          <h1 className="text-xl font-bold text-slate-900">Auctions <span className="text-slate-400 font-normal text-sm">({auctions.length})</span></h1>
        </div>
        <StartAuctionButton />
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-1.5 mb-5" data-testid="auction-status-filter">
        {STATUS_FILTERS.map(s => {
          const active = (s === "ALL" && !statusFilter) || s === status;
          return (
            <Link key={s} href={s === "ALL" ? "/admin/auctions" : `/admin/auctions?status=${s}`}
              data-testid={`auction-filter-${s.toLowerCase()}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                active ? "bg-al-primary text-white border-al-primary" : "bg-white text-slate-600 border-slate-200 hover:border-al-primary/30"
              }`}>
              {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </Link>
          );
        })}
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 flex items-start gap-2 text-red-700" data-testid="auctions-load-error">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-sm">Failed to load auctions</p>
            <p className="text-xs mt-0.5 font-mono">{loadError}</p>
          </div>
        </div>
      )}
      {!loadError && auctions.length === 0 && (
        <div className="text-center py-12 text-slate-400" data-testid="no-auctions">
          {statusFilter ? `No ${status.toLowerCase()} auctions found.` : "No auctions found"}
        </div>
      )}
      <div className="space-y-2">
        {auctions.map(a => (
          <Link key={a.id} href={`/admin/auctions/${a.id}`} data-testid={`auction-row-${a.id}`}
            className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4 hover:border-al-primary/30 transition-colors">
            <div>
              <p className="font-semibold text-slate-900 text-sm">Auction #{a.id.slice(-8)}</p>
              <p className="text-xs text-slate-400">
                {a.buyer?.firstName ?? ""} {a.buyer?.lastName ?? ""} · {a._count.invitations} dealer{a._count.invitations !== 1 ? "s" : ""} · {a._count.offers} offer{a._count.offers !== 1 ? "s" : ""}
                {a.endsAt && <> · ends {new Date(a.endsAt).toLocaleString()}</>}
              </p>
            </div>
            <Badge variant={a.status === "ACTIVE" ? "green" : a.status === "CLOSED" ? "gray" : "amber"} className="text-xs">{a.status}</Badge>
          </Link>
        ))}
      </div>
    </div>
  );
}
