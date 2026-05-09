import { requireDealer } from "@/lib/auth/dealer-session";
import { FolderOpen } from "lucide-react";
import { prisma } from "@/lib/prisma";
import DealerDocumentUploadButton from "@/components/dealer/DealerDocumentUploadButton";

export const dynamic = "force-dynamic";

export default async function DealerDocumentsPage() {
  const dealer = await requireDealer();
  const documents = await prisma.document.findMany({
    where: { dealerId: dealer.id },
    orderBy: { uploadedAt: "desc" },
  });

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="dealer-documents-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FolderOpen size={22} className="text-[#0B5FD1]" />
          <h1 className="text-xl font-bold text-slate-900">Documents</h1>
        </div>
        <DealerDocumentUploadButton />
      </div>
      {documents.length === 0 ? (
        <p className="text-slate-500 text-sm">
          No documents. Upload dealer documents and compliance records here.
        </p>
      ) : (
        <div className="space-y-2">
          {documents.map((d, i) => (
            <div
              key={d.id}
              data-testid={`dealer-doc-${i}`}
              className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4"
            >
              <p className="font-medium text-slate-800 text-sm">{d.name}</p>
              <span className="text-xs text-slate-400">{d.uploadedAt.toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
