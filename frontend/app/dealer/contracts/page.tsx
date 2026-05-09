import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, Upload } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

function statusVariant(status: string): "green" | "amber" | "destructive" | "secondary" {
  if (status === "APPROVED") return "green";
  if (status === "SCANNING" || status === "UPLOADED") return "amber";
  if (status === "REJECTED") return "destructive";
  return "secondary";
}

export default async function DealerContractsPage() {
  const dealer = await requireDealer();

  // ContractVersion.uploadedBy holds the dealer ID
  const contracts = await prisma.contractVersion.findMany({
    where: { uploadedBy: dealer.id },
    orderBy: { uploadedAt: "desc" },
    take: 50,
  });

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="dealer-contracts-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Shield size={22} className="text-[#0B5FD1]" />
          <h1 className="text-xl font-bold text-slate-900">Contracts</h1>
          {contracts.length > 0 && <Badge variant="secondary">{contracts.length}</Badge>}
        </div>
        <Button size="sm" href="/dealer/contracts/upload" data-testid="upload-contract-btn">
          <Upload size={14} /> Upload Contract
        </Button>
      </div>

      {contracts.length === 0 ? (
        <div className="text-center py-20 bg-white border border-slate-200 rounded-xl text-slate-400" data-testid="no-contracts">
          <Shield size={32} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium text-slate-600 mb-1">No contracts yet</p>
          <p className="text-sm max-w-sm mx-auto">
            Upload a sale contract for Contract Shield review. Contracts are scanned automatically for
            junk fees and compliance issues.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {contracts.map((cv) => (
            <Link
              key={cv.id}
              href={`/dealer/contracts/${cv.id}`}
              data-testid={`contract-item-${cv.id}`}
              className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4 hover:border-[#0B5FD1]/30 transition-colors"
            >
              <div>
                <p className="text-sm font-semibold text-slate-900 font-mono">
                  Contract v{cv.version} · Deal #{cv.dealId.slice(0, 8)}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Uploaded {cv.uploadedAt.toLocaleDateString()}
                </p>
              </div>
              <Badge variant={statusVariant(cv.status)} className="text-xs shrink-0">
                {cv.status}
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
