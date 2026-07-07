import { requireDealer } from "@/lib/auth/dealer-session";
import { FolderOpen, Link2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import DealerDocumentUploadButton from "@/components/dealer/DealerDocumentUploadButton";
import { PageContainer, PageHeader, EmptyState, CARD } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function vehicleLabel(vehicles: { year: number | null; make: string | null; model: string | null }[]): string {
  const v = vehicles[0];
  if (!v) return "";
  return [v.year, v.make, v.model].filter(Boolean).join(" ");
}

export default async function DealerDocumentsPage() {
  const dealer = await requireDealer();

  const [documents, deals] = await Promise.all([
    prisma.document.findMany({
      where: { dealerId: dealer.id },
      orderBy: { uploadedAt: "desc" },
    }),
    // The dealer's deals (scoped via the accepted offer) — used to associate an
    // uploaded document with the correct deal at upload time.
    prisma.deal.findMany({
      where: { offer: { dealerId: dealer.id } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        createdAt: true,
        offer: { select: { auction: { select: { vehicles: { select: { year: true, make: true, model: true } } } } } },
      },
    }),
  ]);

  const dealOptions = deals.map((d) => {
    const label = vehicleLabel(d.offer?.auction?.vehicles ?? []);
    return {
      id: d.id,
      label: `Deal ${d.id.slice(0, 8)}${label ? ` · ${label}` : ""} · ${d.createdAt.toLocaleDateString()}`,
    };
  });

  return (
    <PageContainer testId="dealer-documents-page">
      <PageHeader
        title="Documents"
        subtitle="Deal documents, finance agreements, and compliance records."
        actions={<DealerDocumentUploadButton deals={dealOptions} />}
      />
      {documents.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No documents yet"
          body="Upload deal documents (sales contracts, finance agreements, buyer orders) or compliance records here."
          testId="no-dealer-documents"
        />
      ) : (
        <div className="space-y-2">
          {documents.map((d, i) => (
            <div
              key={d.id}
              data-testid={`dealer-doc-${i}`}
              className={cn(CARD, "flex items-center justify-between px-5 py-4")}
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-800 text-sm truncate">{d.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] font-medium text-slate-500">
                    {d.type.replace(/_/g, " ")}
                  </span>
                  {d.dealId && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-al-primary font-mono tabular-nums">
                      <Link2 size={11} /> Deal {d.dealId.slice(0, 8)}
                    </span>
                  )}
                </div>
              </div>
              <span className="text-xs text-slate-500 shrink-0 ml-3 tabular-nums">{d.uploadedAt.toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
