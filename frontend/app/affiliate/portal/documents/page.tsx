import { logger } from "@/lib/logger";
import { requireAffiliate } from "@/lib/auth/affiliate-session";
import { prisma } from "@/lib/prisma";
import { FileCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import AffiliateDocumentUpload from "@/components/affiliate/AffiliateDocumentUpload";
import DocumentViewButton from "@/components/affiliate/DocumentViewButton";

const REQUIRED_DOCS = [
  { type: "W9", label: "W-9 Tax Form", description: "Required for US tax reporting" },
  { type: "GOVERNMENT_ID", label: "Government-Issued ID", description: "Passport, driver's license, or state ID" },
];

function statusVariant(status: string): "green" | "destructive" | "amber" | "secondary" {
  if (status === "APPROVED") return "green";
  if (status === "REJECTED") return "destructive";
  if (status === "PENDING") return "amber";
  return "secondary";
}

export const dynamic = "force-dynamic";

export default async function AffiliateDocumentsPage() {
  const affiliate = await requireAffiliate();

  // M-18: distinguish "no documents" from "the read failed". A DB error must
  // render as an error state with the checklist disabled — never as an empty
  // list, which would invite re-uploads of documents that may already exist.
  let documents: Awaited<ReturnType<typeof prisma.affiliateDocument.findMany>> = [];
  let loadError = false;
  try {
    documents = await prisma.affiliateDocument.findMany({
      where: { affiliateId: affiliate.id },
      orderBy: { uploadedAt: "desc" },
    });
  } catch (err) {
    loadError = true;
    logger.error("[documents] failed to load affiliate documents:", err);
  }

  const docsByType = new Map(documents.map(d => [d.type, d]));

  if (loadError) {
    return (
      <div className="p-6 md:p-8 max-w-2xl" data-testid="affiliate-documents-page">
        <div className="flex items-center gap-3 mb-6">
          <FileCheck size={22} className="text-[#0B5FD1]" />
          <h1 className="text-xl font-bold text-slate-900">Documents</h1>
        </div>
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-xl px-5 py-6 text-center"
          data-testid="documents-load-error"
        >
          <p className="text-sm font-medium text-red-700">
            We couldn&apos;t load your documents right now. Your uploads are safe — please refresh in a moment.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="affiliate-documents-page">
      <div className="flex items-center gap-3 mb-6">
        <FileCheck size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Documents</h1>
      </div>
      <p className="text-sm text-slate-500 mb-8">
        Upload required compliance documents. Files are stored securely and reviewed by the AutoLenis team.
      </p>

      {/* Required documents status */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Required Documents</p>
        <div className="space-y-3">
          {REQUIRED_DOCS.map(req => {
            const doc = docsByType.get(req.type);
            return (
              <div key={req.type} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <div>
                  <p className="text-sm font-medium text-slate-800">{req.label}</p>
                  <p className="text-xs text-slate-400">{req.description}</p>
                </div>
                {doc ? (
                  <Badge variant={statusVariant(doc.status)}>{doc.status}</Badge>
                ) : (
                  <Badge variant="secondary">Not uploaded</Badge>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Upload form */}
      <AffiliateDocumentUpload />

      {/* Document list */}
      {documents.length > 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mt-6">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">
            Uploaded Documents ({documents.length})
          </p>
          <div className="space-y-3">
            {documents.map(doc => (
              <div key={doc.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{doc.fileName}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {doc.type} · {(doc.fileSizeBytes / 1024).toFixed(0)} KB · {new Date(doc.uploadedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <DocumentViewButton documentId={doc.id} />
                  <Badge variant={statusVariant(doc.status)}>{doc.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-6 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-8 text-center">
          <FileCheck size={28} className="text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No documents uploaded yet</p>
        </div>
      )}
    </div>
  );
}
