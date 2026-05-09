import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

interface FixItem {
  item?: string;
  reason?: string;
  foundValue?: string;
  expectedValue?: string;
  howToFix?: string;
  ruleId?: string;
}

function severityFromFixItem(item: FixItem): "CRITICAL" | "WARNING" | "INFO" {
  if (item.ruleId?.startsWith("BUILTIN_DOC_FEE_CAP") || item.ruleId?.startsWith("BUILTIN_ADDON_PACKING")) return "CRITICAL";
  if (item.ruleId?.startsWith("BUILTIN_ADDON_DISCLOSURE")) return "WARNING";
  return "INFO";
}

function severityVariant(s: string): "destructive" | "amber" | "blue" | "secondary" {
  if (s === "CRITICAL") return "destructive";
  if (s === "WARNING") return "amber";
  if (s === "INFO") return "blue";
  return "secondary";
}

function severityIcon(s: string) {
  if (s === "CRITICAL") return <AlertTriangle size={14} className="text-red-500" />;
  if (s === "WARNING") return <AlertTriangle size={14} className="text-amber-500" />;
  return <Info size={14} className="text-blue-500" />;
}

export default async function ContractDetailPage({ params }: Props) {
  const { id } = await params;
  const dealer = await requireDealer();

  // ContractVersion.uploadedBy holds the dealer ID
  const contractVersion = await prisma.contractVersion.findFirst({
    where: { id, uploadedBy: dealer.id },
  });

  if (!contractVersion) notFound();

  // Fetch the latest contract scan for this deal
  const latestScan = await prisma.contractScan.findFirst({
    where: { dealId: contractVersion.dealId },
    orderBy: { version: "desc" },
  });

  const scanStatus = latestScan?.status ?? null;
  const passed = scanStatus === "PASS";
  const fixItems: FixItem[] = Array.isArray(latestScan?.fixList) ? (latestScan.fixList as FixItem[]) : [];

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="contract-detail-page">
      <Link
        href="/dealer/contracts"
        className="text-sm text-slate-400 hover:text-[#0B5FD1] transition-colors mb-6 flex items-center gap-1"
      >
        ← Back to Contracts
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <Shield size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Contract Shield Review</h1>
      </div>

      {/* Metadata */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5" data-testid="contract-metadata">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
          Contract Details
        </p>
        <dl className="space-y-3">
          {[
            { label: "Contract ID", value: contractVersion.id.slice(0, 16) + "…" },
            { label: "Uploaded", value: contractVersion.uploadedAt.toLocaleDateString() },
            { label: "Deal ID", value: contractVersion.dealId },
            { label: "Version", value: `v${contractVersion.version}` },
          ].map(({ label, value }) => (
            <div key={label} className="flex gap-4">
              <dt className="text-sm text-slate-400 w-28 shrink-0">{label}</dt>
              <dd className="text-sm font-medium text-slate-900">{value}</dd>
            </div>
          ))}
          <div className="flex gap-4">
            <dt className="text-sm text-slate-400 w-28 shrink-0">Status</dt>
            <dd>
              <Badge variant="secondary" className="text-xs">
                {contractVersion.status}
              </Badge>
            </dd>
          </div>
        </dl>
      </div>

      {/* Scan Status */}
      <div className="mb-5" data-testid="scan-status">
        {!latestScan && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-5 py-4 text-sm text-slate-500">
            Scan pending…
          </div>
        )}
        {latestScan && (scanStatus === "PASS" || scanStatus === "APPROVED") && (
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-5 py-4">
            <CheckCircle2 size={18} className="text-green-600" />
            <div>
              <span className="font-semibold text-green-700 text-sm">
                ✓ Contract Shield: PASSED
              </span>
              {latestScan.score != null && (
                <p className="text-xs text-green-600 mt-0.5">Score: {latestScan.score}/100</p>
              )}
            </div>
          </div>
        )}
        {latestScan && scanStatus === "WARNING" && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
            <AlertTriangle size={18} className="text-amber-600" />
            <div>
              <span className="font-semibold text-amber-700 text-sm">
                ⚠ Contract Shield: WARNING
              </span>
              {latestScan.score != null && (
                <p className="text-xs text-amber-600 mt-0.5">Score: {latestScan.score}/100</p>
              )}
            </div>
          </div>
        )}
        {latestScan && (scanStatus === "FAIL" || scanStatus === "FAILED") && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-4">
            <AlertTriangle size={18} className="text-red-600" />
            <div>
              <span className="font-semibold text-red-700 text-sm">
                ✗ Contract Shield: Issues Found
              </span>
              {latestScan.score != null && (
                <p className="text-xs text-red-600 mt-0.5">Score: {latestScan.score}/100</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Fix List */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5" data-testid="fix-list">
        <p className="text-sm font-semibold text-slate-800 mb-3">Review Items</p>
        {passed || fixItems.length === 0 ? (
          <p className="text-sm text-green-600">No issues found.</p>
        ) : (
          <div className="space-y-2">
            {fixItems.map((issue, idx) => {
              const sev = severityFromFixItem(issue);
              const label = issue.item ?? issue.foundValue ?? `Issue ${idx + 1}`;
              return (
                <div
                  key={idx}
                  className="flex items-start gap-3 bg-slate-50 border border-slate-100 rounded-lg px-4 py-3"
                  data-testid={`issue-${idx}`}
                >
                  {severityIcon(sev)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 font-medium">{label}</p>
                    {issue.reason && <p className="text-xs text-slate-500 mt-0.5">{issue.reason}</p>}
                    {issue.howToFix && <p className="text-xs text-blue-600 mt-1">{issue.howToFix}</p>}
                  </div>
                  <Badge variant={severityVariant(sev)} className="text-xs shrink-0">
                    {sev}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Button href="/dealer/contracts/upload" variant="secondary" data-testid="resubmit-btn">
        Resubmit Contract
      </Button>
    </div>
  );
}
