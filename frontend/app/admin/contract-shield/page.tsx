// Feature 28 — Contract Shield Queue with Risk Scoring
// Risk scoring is derived from real signals: scan status, fix list length, junk fees on offer.
// If signals are unavailable, "Risk scoring unavailable" is shown per requirements.

import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, AlertTriangle, Info } from "lucide-react";
import ContractShieldReviewActions from "@/components/admin/ContractShieldReviewActions";

export const dynamic = "force-dynamic";

// Derive a risk severity from real signals on a scan record.
// Returns null if insufficient data to compute a severity.
function deriveRiskSeverity(scan: {
  status: string;
  score: number;
  fixList: unknown;
  deal: {
    riskScore: number | null;
    offer: { feesCents: number; junkFeeItems: unknown } | null;
  };
}): { tier: string; signals: string[] } | null {
  const signals: string[] = [];

  // Signal 1: existing contract scan status
  if (scan.status === "FAIL") signals.push("Contract scan failed");

  // Signal 2: fix list length
  const fixList = Array.isArray(scan.fixList) ? scan.fixList : [];
  if (fixList.length >= 3) signals.push(`${fixList.length} issues in fix list`);

  // Signal 3: scan score below threshold
  if (scan.score < 40) signals.push(`Low scan score (${scan.score})`);

  // Signal 4: fee anomalies — junk fees present
  const rawJunkFees = scan.deal.offer?.junkFeeItems;
  const junkFeeCount = Array.isArray(rawJunkFees) ? rawJunkFees.length : 0;
  if (junkFeeCount > 0) signals.push(`${junkFeeCount} junk fee item(s) on offer`);

  // Signal 5: existing risk score on deal
  if (scan.deal.riskScore !== null && scan.deal.riskScore >= 70) {
    signals.push(`Deal risk score: ${scan.deal.riskScore}`);
  }

  if (signals.length === 0) return null;

  const severity =
    signals.length >= 4 || scan.score < 20
      ? "CRITICAL"
      : signals.length >= 3 || scan.score < 40
      ? "HIGH"
      : signals.length >= 2
      ? "MEDIUM"
      : "LOW";

  return { tier: severity, signals };
}

const RISK_COLOR: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800 border-red-200",
  HIGH: "bg-orange-100 text-orange-800 border-orange-200",
  MEDIUM: "bg-amber-100 text-amber-800 border-amber-200",
  LOW: "bg-green-100 text-green-800 border-green-200",
};

export default async function AdminContractShieldPage() {
  await requireAdmin();

  const [scans, rules] = await Promise.all([
    prisma.contractScan.findMany({
      orderBy: { scannedAt: "desc" },
      take: 50,
      include: {
        deal: {
          select: {
            riskScore: true,
            buyer: { select: { firstName: true, lastName: true } },
            offer: { select: { feesCents: true, junkFeeItems: true } },
          },
        },
      },
    }),
    prisma.contractScanRule.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  const pendingScans = scans.filter(s => s.status !== "PASS");
  const passedScans = scans.filter(s => s.status === "PASS");

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-contract-shield-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Shield size={22} className="text-al-primary" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">Contract Shield Queue</h1>
            <p className="text-xs text-slate-400 mt-0.5">Feature 28 · Risk scoring from real signals</p>
          </div>
        </div>
        <Button size="sm" href="/admin/contract-shield/rules" data-testid="manage-rules-btn" variant="secondary">
          Manage Rules ({rules.length})
        </Button>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Pending Review", value: pendingScans.length, color: "text-red-600" },
          { label: "Passed", value: passedScans.length, color: "text-green-600" },
          { label: "Total Scans", value: scans.length, color: "text-slate-700" },
        ].map(s => (
          <div key={s.label} data-testid={`shield-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
            className="bg-white border border-slate-200 rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {scans.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center" data-testid="shield-empty">
          <Shield size={32} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No contract scans on record.</p>
        </div>
      )}

      {scans.length > 0 && (
        <div className="space-y-2">
          {scans.map(s => {
            const risk = deriveRiskSeverity(s);

            return (
              <div
                key={s.id}
                data-testid={`scan-row-${s.id}`}
                className="bg-white border border-slate-200 rounded-xl px-5 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 text-sm">
                      {s.deal.buyer.firstName} {s.deal.buyer.lastName}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Score: {s.score} · {s.scannedAt.toLocaleDateString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Scan status badge */}
                    <Badge
                      variant={s.status === "PASS" ? "green" : s.status === "WARNING" ? "amber" : "destructive"}
                      className="text-xs"
                      data-testid={`scan-status-${s.id}`}
                    >
                      {s.status}
                    </Badge>

                    {/* Risk tier badge */}
                    {risk ? (
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${RISK_COLOR[risk.tier] ?? ""}`}
                        data-testid={`risk-tier-${s.id}`}
                      >
                        {risk.tier} RISK
                      </span>
                    ) : (
                      <span
                        className="text-xs text-slate-400 flex items-center gap-1"
                        data-testid={`risk-unavailable-${s.id}`}
                      >
                        <Info size={11} />
                        Risk scoring unavailable
                      </span>
                    )}
                  </div>
                </div>

                {/* Risk signals list */}
                {risk && risk.signals.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5" data-testid={`risk-signals-${s.id}`}>
                    {risk.signals.map((sig, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded px-2 py-0.5"
                      >
                        <AlertTriangle size={10} />
                        {sig}
                      </span>
                    ))}
                  </div>
                )}

                {/* Admin review actions — approve / flag / request revision */}
                <ContractShieldReviewActions reviewId={s.id} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
