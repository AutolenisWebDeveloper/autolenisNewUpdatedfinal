import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, Upload } from "lucide-react";
import Link from "next/link";
import { PageContainer, PageHeader, EmptyState, CARD, CARD_HOVER } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";

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
    <PageContainer testId="dealer-contracts-page">
      <PageHeader
        title="Contracts"
        subtitle="Sale contracts submitted for automated Contract Shield review."
        eyebrow={contracts.length > 0 ? <Badge variant="secondary">{contracts.length}</Badge> : undefined}
        actions={
          <Button size="sm" href="/dealer/contracts/upload" data-testid="upload-contract-btn">
            <Upload size={14} /> Upload Contract
          </Button>
        }
      />

      {contracts.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="No contracts yet"
          body="Upload a sale contract for Contract Shield review. Contracts are scanned automatically for junk fees and compliance issues."
          action={{ label: "Upload a contract", href: "/dealer/contracts/upload", testId: "contracts-empty-cta" }}
          testId="no-contracts"
        />
      ) : (
        <div className="space-y-2">
          {contracts.map((cv) => (
            <Link
              key={cv.id}
              href={`/dealer/contracts/${cv.id}`}
              data-testid={`contract-item-${cv.id}`}
              className={cn(CARD, CARD_HOVER, "flex items-center justify-between px-5 py-4")}
            >
              <div>
                <p className="text-sm font-semibold text-slate-900 font-mono tabular-nums">
                  Contract v{cv.version} · Deal #{cv.dealId.slice(0, 8)}
                </p>
                <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
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
    </PageContainer>
  );
}
