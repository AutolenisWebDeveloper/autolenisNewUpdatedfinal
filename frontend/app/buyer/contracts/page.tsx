import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contracts" };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { FileText } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ContractsPage() {
  const buyer = await requireBuyer();
  const deals = await prisma.deal.findMany({
    where: { buyerId: buyer.id },
    include: { contractScans: { orderBy: { scannedAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="contracts-page">
      <div className="flex items-center gap-3 mb-6">
        <FileText size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Contracts</h1>
      </div>
      {deals.length === 0 ? (
        <div className="text-center py-16 bg-white border border-slate-200 rounded-xl" data-testid="no-contracts">
          <FileText size={32} className="text-slate-200 mx-auto mb-3" />
          <p className="font-medium text-slate-600 mb-1">No contracts yet</p>
          <p className="text-sm text-slate-400 max-w-sm mx-auto px-6">
            Once you accept a dealer offer, your purchase contract will appear here for review and signing.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {deals.map((deal) => (
            <Link key={deal.id} href={`/buyer/contracts/${deal.id}`} data-testid={`contract-deal-${deal.id}`}
              className="block bg-white border border-slate-200 rounded-xl p-5 hover:border-al-primary hover:shadow-sm transition-all">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-900 text-sm">Deal #{deal.id.slice(-8)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{deal.status.replace(/_/g, " ")}</p>
                </div>
                {deal.contractScans[0] && (
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                    deal.contractScans[0].status === "PASS" ? "bg-green-100 text-green-700" :
                    deal.contractScans[0].status === "WARNING" ? "bg-amber-100 text-amber-700" :
                    "bg-red-100 text-red-700"
                  }`}>Shield: {deal.contractScans[0].status}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
