import type { Metadata } from "next";

export const metadata: Metadata = { title: "Documents" };

import { requireBuyer } from "@/lib/auth/session";
import { getBuyerDocuments } from "@/lib/services/documents/document.service";
import { FolderOpen, FileText, CheckCircle2 } from "lucide-react";
import DocumentUploadButton from "@/components/buyer/DocumentUploadButton";
export const dynamic = "force-dynamic";
export default async function DocumentsPage() {
  const buyer = await requireBuyer();
  const documents = await getBuyerDocuments(buyer.id);
  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="documents-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3"><FolderOpen size={22} className="text-al-primary" /><h1 className="text-xl font-bold text-slate-900">Documents</h1></div>
        <DocumentUploadButton />
      </div>
      {documents.length === 0 ? (
        <div className="text-center py-16 bg-white border border-slate-200 rounded-xl" data-testid="no-documents"><FolderOpen size={32} className="text-slate-200 mx-auto mb-3" /><p className="text-slate-500 text-sm">No documents yet. Deal documents and contracts will appear here.</p></div>
      ) : (
        <div className="space-y-2">{documents.map((doc, i) => (
          <div key={doc.id} data-testid={`document-${i}`} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4">
            <div className="flex items-center gap-3"><FileText size={18} className="text-slate-400" /><div><p className="font-semibold text-slate-800 text-sm">{doc.name}</p><p className="text-xs text-slate-400">{doc.type.replace(/_/g, " ")} · {doc.uploadedAt.toLocaleDateString()}</p></div></div>
            {doc.isVerified && <CheckCircle2 size={16} className="text-green-500" />}
          </div>
        ))}</div>
      )}
    </div>
  );
}
