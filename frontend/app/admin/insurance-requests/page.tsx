// /admin/insurance-requests — lists all pending insurance quote requests
// Reads AdminAuditLog entries with action = "INSURANCE_QUOTE_REQUESTED"
// Allows admin to respond with a quote (updates deal.insuranceStatus → QUOTE_RECEIVED)
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { Shield, AlertTriangle } from "lucide-react";
import Link from "next/link";
import InsuranceRequestsClient from "./InsuranceRequestsClient";

export const metadata: Metadata = { title: "Insurance Quote Requests — Admin" };
export const dynamic = "force-dynamic";

export type InsuranceQuoteRequest = {
  id:             string;
  dealId:         string;
  buyerId:        string;
  buyerName:      string;
  vehicle:        string;
  otdPriceCents:  number | null;
  coverageType:   string;
  currentInsurer: string | null;
  driverDob:      string | null;
  additionalInfo: string | null;
  requestedAt:    string;
  dealStatus:     string;
  insuranceStatus: string;
};

export default async function AdminInsuranceRequestsPage() {
  await requireAdmin();

  let requests: InsuranceQuoteRequest[] = [];
  let loadError: string | null = null;

  try {
    const logs = await prisma.adminAuditLog.findMany({
      where: { action: "INSURANCE_QUOTE_REQUESTED" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // For each log, fetch the current deal status so we can show stale/resolved entries
    const dealIds = [...new Set(logs.map(l => l.entityId))];
    const deals = dealIds.length > 0
      ? await prisma.deal.findMany({
          where: { id: { in: dealIds } },
          select: { id: true, status: true, insuranceStatus: true },
        })
      : [];
    const dealMap = new Map(deals.map(d => [d.id, d]));

    requests = logs
      .map(log => {
        const meta = (log.metadata ?? {}) as Record<string, unknown>;
        const deal = dealMap.get(log.entityId);
        return {
          id:             log.id,
          dealId:         log.entityId,
          buyerId:        (meta.buyerId  as string) ?? "",
          buyerName:      (meta.buyerName as string) ?? "Unknown Buyer",
          vehicle:        (meta.vehicle  as string) ?? "Vehicle details unavailable",
          otdPriceCents:  typeof meta.otdPriceCents === "number" ? meta.otdPriceCents : null,
          coverageType:   (meta.coverageType   as string) ?? "full",
          currentInsurer: (meta.currentInsurer as string | null) ?? null,
          driverDob:      (meta.driverDob      as string | null) ?? null,
          additionalInfo: (meta.additionalInfo as string | null) ?? null,
          requestedAt:    (meta.requestedAt as string) ?? log.createdAt.toISOString(),
          dealStatus:     deal?.status           ?? "UNKNOWN",
          insuranceStatus: deal?.insuranceStatus ?? "UNKNOWN",
        };
      });
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error loading insurance requests";
  }

  const pending  = requests.filter(r => r.insuranceStatus === "QUOTE_REQUESTED");
  const resolved = requests.filter(r => r.insuranceStatus !== "QUOTE_REQUESTED" && r.insuranceStatus !== "UNKNOWN");

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-insurance-requests-page">
      <div className="flex items-center gap-3 mb-6">
        <Shield size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">
          Insurance Quote Requests
          <span className="ml-2 text-slate-400 font-normal text-sm">({pending.length} pending)</span>
        </h1>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-2 text-red-700" data-testid="requests-load-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-sm">Failed to load requests</p>
            <p className="text-xs mt-0.5 font-mono">{loadError}</p>
          </div>
        </div>
      )}

      {!loadError && pending.length === 0 && (
        <div className="text-center py-16 text-slate-400" data-testid="no-pending-requests">
          <Shield size={32} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No pending insurance quote requests</p>
          <p className="text-sm mt-1">New requests appear here when buyers submit the quote form.</p>
        </div>
      )}

      {pending.length > 0 && (
        <section className="mb-8" data-testid="pending-requests-section">
          <h2 className="text-sm font-semibold text-[#374151] mb-3">
            Pending ({pending.length})
          </h2>
          <InsuranceRequestsClient requests={pending} />
        </section>
      )}

      {resolved.length > 0 && (
        <section data-testid="resolved-requests-section">
          <h2 className="text-sm font-semibold text-[#374151] mb-3">
            Resolved / Historical ({resolved.length})
          </h2>
          <div className="space-y-2">
            {resolved.map(r => (
              <div key={r.id}
                className="flex items-center justify-between bg-white border border-[#E5E7EB] rounded-xl px-5 py-3.5 opacity-70"
                data-testid={`resolved-request-${r.id}`}>
                <div>
                  <p className="font-semibold text-slate-900 text-sm">{r.buyerName} — {r.vehicle}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {r.coverageType.replace(/_/g, " ")} ·{" "}
                    {new Date(r.requestedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-[#6B7280] bg-[#F3F4F6] px-2 py-1 rounded-md">
                    {r.insuranceStatus.replace(/_/g, " ")}
                  </span>
                  <Link
                    href={`/admin/deals/${r.dealId}`}
                    className="text-xs text-al-primary hover:underline"
                    data-testid={`view-deal-${r.id}`}
                  >
                    View Deal →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
