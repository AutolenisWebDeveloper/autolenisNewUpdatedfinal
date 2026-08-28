import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contract", robots: { index: false, follow: false } };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { buyerFacingDealerName } from "@/lib/services/offer/dealer-display";
import { notFound } from "next/navigation";
import { Shield, CheckCircle2, AlertTriangle, XCircle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import ContractPdfViewer from "@/components/buyer/ContractPdfViewer";
import { BUYER_SAFE_ENVELOPE_SELECT } from "@/lib/services/esign/esign-schema-gate";

export const dynamic = "force-dynamic";
interface Props { params: Promise<{ contractId: string }> }

export default async function ContractDetailPage({ params }: Props) {
  const { contractId } = await params;
  const buyer = await requireBuyer();

  // Ownership enforced — buyer can only view their own contracts
  const deal = await prisma.deal.findFirst({
    where: { buyerId: buyer.id },
    include: {
      contractScans: { orderBy: { scannedAt: "desc" } },
      eSignEnvelope: { select: BUYER_SAFE_ENVELOPE_SELECT },
      offer: { include: { dealer: { select: { dealershipName: true, tier: true, isSystemPlaceholder: true } } } },
      vehicleRequestOffer: { select: { priceCents: true, vehicleInfo: true, notes: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Use deal ID as contract identifier — enforce ownership
  if (!deal || deal.id !== contractId) notFound();

  const otdPriceCents = deal.offer?.otdPriceCents ?? deal.vehicleRequestOffer?.priceCents ?? 0;
  const dealerName = buyerFacingDealerName(deal.offer);
  // A concierge/placeholder offer isn't a tiered dealer → don't label it one.
  const isPlaceholderDealer = deal.offer?.dealer?.isSystemPlaceholder === true;
  const dealerTier = isPlaceholderDealer ? null : (deal.offer?.dealer?.tier ?? "STANDARD");

  const latestScan = deal.contractScans[0];
  const scanHistory = deal.contractScans;

  const shieldColor = {
    PASS: "text-green-700 bg-green-50 border-green-200",
    WARNING: "text-amber-700 bg-amber-50 border-amber-200",
    FAIL: "text-red-700 bg-red-50 border-red-200",
  };

  const statusTimeline = [
    { label: "Contract received", done: !!latestScan, date: latestScan?.scannedAt },
    { label: "Contract Shield scan", done: !!latestScan, date: latestScan?.scannedAt, result: latestScan?.status },
    { label: "Sent for signing", done: !!deal.eSignEnvelope?.sentAt, date: deal.eSignEnvelope?.sentAt },
    { label: "Signed", done: deal.eSignEnvelope?.status === "COMPLETED", date: deal.eSignEnvelope?.completedAt },
  ];

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="contract-detail-page">
      <div className="flex items-center gap-3 mb-6">
        <Shield size={22} className="text-al-primary" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Contract Detail</h1>
          <p className="text-sm text-slate-400">Deal #{deal.id.slice(-8)}</p>
        </div>
      </div>

      {/* Deal summary */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6 flex items-center justify-between" data-testid="contract-deal-summary">
        <div>
          <p className="text-sm font-semibold text-slate-900">${(otdPriceCents / 100).toLocaleString()} out-the-door</p>
          <p className="text-xs text-slate-400 mt-0.5">{dealerName}{dealerTier ? ` · ${dealerTier} Dealer` : ""}</p>
        </div>
        <Badge variant={deal.status === "COMPLETED" ? "green" : "blue"}>{deal.status.replace(/_/g, " ")}</Badge>
      </div>

      {/* Contract Shield result */}
      {latestScan ? (
        <div data-testid="contract-shield-result" className={`border-2 rounded-2xl p-6 mb-6 ${shieldColor[latestScan.status as keyof typeof shieldColor] ?? "border-slate-200 bg-slate-50"}`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1 opacity-70">Contract Shield</p>
              <div className="flex items-center gap-2">
                {latestScan.status === "PASS" ? <CheckCircle2 size={20} /> : latestScan.status === "WARNING" ? <AlertTriangle size={20} /> : <XCircle size={20} />}
                <span className="text-xl font-bold">{latestScan.status}</span>
                <span className="text-2xl font-bold opacity-60">·</span>
                <span className="text-2xl font-bold">{latestScan.score}/100</span>
              </div>
            </div>
            <p className="text-xs opacity-60">Scanned {latestScan.scannedAt.toLocaleDateString()}</p>
          </div>

          {/* Fix list with actionable guidance */}
          {Array.isArray(latestScan.fixList) && (latestScan.fixList as unknown[]).length > 0 && (
            <div className="space-y-2" data-testid="contract-fix-list">
              {(latestScan.fixList as Array<{ foundValue: string; expectedValue: string; howToFix: string }>).map((item, i) => (
                <div key={i} className="bg-white/60 rounded-lg p-3 border border-current/10">
                  <p className="text-sm font-medium mb-0.5">{item.howToFix}</p>
                  <p className="text-xs opacity-60">Found: <strong>{item.foundValue}</strong> · Expected: <strong>{item.expectedValue}</strong></p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-6 text-center" data-testid="no-contract-scan">
          <AlertTriangle size={28} className="text-amber-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-800">Awaiting contract from dealer</p>
        </div>
      )}

      {/* PDF Viewer */}
      <ContractPdfViewer
        downloadUrl={`/api/buyer/deals/${deal.id}/contract/download`}
      />

      {/* Signing status timeline */}
      <div className="mb-6" data-testid="signing-timeline">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Signing Timeline</h2>
        <div className="space-y-3">
          {statusTimeline.map((step, i) => (
            <div key={i} data-testid={`timeline-step-${i}`} className={`flex items-center gap-3 text-sm ${step.done ? "text-slate-700" : "text-slate-400"}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${step.done ? "bg-green-500 text-white" : "bg-slate-200"}`}>
                {step.done ? "✓" : ""}
              </div>
              <span className="flex-1 font-medium">{step.label}</span>
              {step.done && (step as { date?: Date }).date && (
                <span className="text-xs text-slate-400">{(step as { date: Date }).date.toLocaleDateString()}</span>
              )}
              {(step as { result?: string }).result && (
                <Badge variant={(step as { result: string }).result === "PASS" ? "green" : "amber"} className="text-xs">
                  {(step as { result: string }).result}
                </Badge>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Scan history */}
      {scanHistory.length > 1 && (
        <div data-testid="scan-history">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Scan History ({scanHistory.length} versions)</h2>
          <div className="space-y-2">
            {scanHistory.map((scan, i) => (
              <div key={scan.id} data-testid={`scan-version-${i}`} className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm">
                <span className="text-slate-600">Version {scan.version}</span>
                <div className="flex items-center gap-2">
                  <Badge variant={scan.status === "PASS" ? "green" : scan.status === "WARNING" ? "amber" : "destructive"} className="text-xs">{scan.status}</Badge>
                  <span className="text-xs text-slate-400">{scan.scannedAt.toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-slate-100">
        <Link href="/buyer/contracts" className="text-sm text-slate-400 hover:text-slate-600 hover:underline" data-testid="back-to-contracts-link">
          ← Back to contracts
        </Link>
      </div>
    </div>
  );
}
