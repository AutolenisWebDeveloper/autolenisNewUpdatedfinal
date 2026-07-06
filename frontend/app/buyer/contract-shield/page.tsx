import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contract Shield" };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Shield, CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ContractShieldPage() {
  const buyer = await requireBuyer();
  const deal = await prisma.deal.findFirst({
    where: { buyerId: buyer.id },
    include: { contractScans: { orderBy: { scannedAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" },
  });

  const latestScan = deal?.contractScans[0];

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="contract-shield-page">
      <div className="flex items-center gap-3 mb-6">
        <Shield size={24} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Contract Shield Review</h1>
      </div>

      {!deal ? (
        <div className="text-center py-12 text-slate-400" data-testid="no-contract">
          <p>No contract to review yet.</p>
        </div>
      ) : !latestScan ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center" data-testid="contract-scan-pending">
          <AlertTriangle size={32} className="text-amber-500 mx-auto mb-3" />
          <h2 className="font-semibold text-slate-900 mb-2">Waiting for dealer contract</h2>
          <p className="text-slate-500 text-sm">The dealer has been notified to upload the contract for review. You will be notified when it&apos;s ready.</p>
        </div>
      ) : (
        <div>
          {/* Shield result */}
          <div data-testid={`shield-result-${latestScan.status}`}
            className={`rounded-2xl p-8 text-center mb-6 ${
              latestScan.status === "PASS" ? "bg-green-50 border-2 border-green-200" :
              latestScan.status === "WARNING" ? "bg-amber-50 border-2 border-amber-200" :
              "bg-red-50 border-2 border-red-200"
            }`}>
            <div data-testid="shield-score-display">
              <div className="flex items-baseline gap-1 justify-center">
                <span className="text-4xl font-bold text-[#111827]">{latestScan.score}</span>
                <span className="text-xl text-[#94A3B8] font-normal"> / 100</span>
              </div>
              <p className={`text-xs font-medium mt-1 ${
                latestScan.score >= 80 ? "text-[#10B981]" :
                latestScan.score >= 60 ? "text-[#F59E0B]" : "text-red-500"
              }`}>
                {latestScan.score >= 80
                  ? "Well above the 60-point passing threshold"
                  : latestScan.score >= 60
                  ? "Above the 60-point passing threshold"
                  : "Below passing threshold — review flagged items before signing"}
              </p>
            </div>
            <p className="font-semibold text-lg text-slate-900 mt-2">{latestScan.status}</p>
            {latestScan.status === "PASS" && (
              <div className="flex items-center justify-center gap-2 text-green-700 mt-2">
                <CheckCircle2 size={18} />
                <span className="text-sm">Contract meets AutoLenis standards</span>
              </div>
            )}
          </div>

          {/* Fix list */}
          {Array.isArray(latestScan.fixList) && (latestScan.fixList as unknown[]).length > 0 && (
            <div className="mb-6" data-testid="contract-fix-list">
              <h3 className="font-semibold text-slate-900 mb-3">Items requiring attention:</h3>
              <div className="space-y-2">
                {(latestScan.fixList as Array<{foundValue: string; expectedValue: string; howToFix: string}>).map((item, i) => (
                  <div key={i} className="bg-white border border-red-200 rounded-lg p-4">
                    <p className="text-sm font-medium text-red-700 mb-1">{item.howToFix}</p>
                    <p className="text-xs text-slate-400">Found: {item.foundValue} · Expected: {item.expectedValue}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {latestScan.status === "PASS" && (
            <Button className="w-full" href="/buyer/esign" data-testid="proceed-to-esign-btn">
              Proceed to E-Sign <ArrowRight size={15} />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
