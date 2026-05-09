import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ documentId: string }>;
}

export default async function DocumentDetailPage({ params }: Props) {
  const { documentId } = await params;
  const dealer = await requireDealer();

  const doc = await prisma.document.findFirst({
    where: { id: documentId, dealerId: dealer.id },
  });

  if (!doc) notFound();

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="document-detail-page">
      <Link
        href="/dealer/documents"
        className="text-sm text-slate-400 hover:text-[#0B5FD1] transition-colors mb-6 flex items-center gap-1"
      >
        ← Back to Documents
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <FileText size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900 truncate">
          {doc.name}
        </h1>
      </div>

      {/* Metadata Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5" data-testid="document-metadata">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
          Document Details
        </p>
        <dl className="space-y-3">
          {[
            { label: "Name", value: doc.name },
            { label: "Type", value: doc.type },
            { label: "Uploaded", value: doc.uploadedAt.toLocaleDateString() },
            { label: "Deal ID", value: doc.dealId ?? "—" },
          ].map(({ label, value }) => (
            <div key={label} className="flex gap-4">
              <dt className="text-sm text-slate-400 w-24 shrink-0">{label}</dt>
              <dd className="text-sm font-medium text-slate-900">{String(value)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Download */}
      <div className="mb-5">
        <Button href={doc.url} data-testid="download-btn">
          Download Document
        </Button>
      </div>

      {/* Verification Status */}
      <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="version-history">
        <p className="text-sm font-semibold text-slate-800 mb-2">Verification</p>
        <p className="text-sm text-slate-400">
          {doc.isVerified ? "Document verified." : "Pending verification."}
        </p>
      </div>
    </div>
  );
}
