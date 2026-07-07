import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { FolderOpen } from "lucide-react";
import DocumentOpenButton from "@/components/admin/DocumentOpenButton";

export const dynamic = "force-dynamic";

export default async function AdminDocumentsPage() {
  await requireAdmin();

  const [platformDocs, affiliateDocs] = await Promise.all([
    prisma.document.findMany({
      orderBy: { uploadedAt: "desc" },
      take:    50,
    }).catch(() => []),
    prisma.affiliateDocument.findMany({
      orderBy: { uploadedAt: "desc" },
      take:    50,
      include: { affiliate: { include: { user: { select: { email: true } } } } },
    }).catch(() => []),
  ]);

  // Resolve buyer emails for platform documents that have a buyerId
  const buyerIds = Array.from(
    new Set(platformDocs.map(d => d.buyerId).filter((id): id is string => Boolean(id)))
  );
  const buyers = buyerIds.length
    ? await prisma.buyer.findMany({
        where:   { id: { in: buyerIds } },
        select:  { id: true, firstName: true, lastName: true, user: { select: { email: true } } },
      }).catch(() => [])
    : [];
  const buyerMap = new Map(buyers.map(b => [b.id, b]));

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-documents-page">
      <div className="flex items-center gap-3 mb-6">
        <FolderOpen size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-[#111827]">Documents</h1>
      </div>

      {/* Platform / Buyer Documents */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider mb-4">
          Platform Documents ({platformDocs.length})
        </h2>
        {platformDocs.length === 0 ? (
          <p className="text-sm text-[#94A3B8]">No platform documents uploaded yet.</p>
        ) : (
          <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#F8F9FB] text-xs text-[#6B7280] uppercase">
                <tr>
                  <th className="text-left px-5 py-3">Owner</th>
                  <th className="text-left px-5 py-3">Name</th>
                  <th className="text-left px-5 py-3">Type</th>
                  <th className="text-left px-5 py-3">Uploaded</th>
                  <th className="text-left px-5 py-3">Status</th>
                  <th className="px-5 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {platformDocs.map(doc => {
                  const buyer = doc.buyerId ? buyerMap.get(doc.buyerId) : undefined;
                  const owner = buyer?.user?.email
                    ?? (buyer ? `${buyer.firstName} ${buyer.lastName}` : null)
                    ?? (doc.dealerId ? `Dealer ${doc.dealerId.slice(0, 8)}` : null)
                    ?? (doc.dealId ? `Deal ${doc.dealId.slice(0, 8)}` : "Unknown");
                  return (
                    <tr key={doc.id} className="hover:bg-[#F8F9FB]">
                      <td className="px-5 py-3 text-[#374151]">{owner}</td>
                      <td className="px-5 py-3 text-[#374151]">{doc.name}</td>
                      <td className="px-5 py-3 text-[#374151]">{doc.type}</td>
                      <td className="px-5 py-3 text-[#94A3B8]">
                        {doc.uploadedAt.toLocaleDateString()}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                          doc.isVerified ? "bg-[#ECFDF5] text-[#065F46]" : "bg-al-primary-subtle text-al-primary"
                        }`}>
                          {doc.isVerified ? "VERIFIED" : "UPLOADED"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <DocumentOpenButton endpoint={`/api/admin/documents/${doc.id}/signed-url`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Affiliate Documents */}
      <section>
        <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider mb-4">
          Affiliate Onboarding Documents ({affiliateDocs.length})
        </h2>
        {affiliateDocs.length === 0 ? (
          <p className="text-sm text-[#94A3B8]">No affiliate documents uploaded yet.</p>
        ) : (
          <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#F8F9FB] text-xs text-[#6B7280] uppercase">
                <tr>
                  <th className="text-left px-5 py-3">Affiliate</th>
                  <th className="text-left px-5 py-3">File</th>
                  <th className="text-left px-5 py-3">Type</th>
                  <th className="text-left px-5 py-3">Uploaded</th>
                  <th className="text-left px-5 py-3">Status</th>
                  <th className="px-5 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {affiliateDocs.map(doc => (
                  <tr key={doc.id} className="hover:bg-[#F8F9FB]">
                    <td className="px-5 py-3 text-[#374151]">
                      {doc.affiliate?.user?.email ?? doc.affiliate?.referralCode ?? "Unknown"}
                    </td>
                    <td className="px-5 py-3 text-[#374151]">{doc.fileName}</td>
                    <td className="px-5 py-3 text-[#374151]">{doc.type}</td>
                    <td className="px-5 py-3 text-[#94A3B8]">
                      {doc.uploadedAt.toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                        doc.status === "APPROVED"  ? "bg-[#ECFDF5] text-[#065F46]"  :
                        doc.status === "REJECTED"  ? "bg-red-50 text-red-700"        :
                        "bg-al-primary-subtle text-al-primary"
                      }`}>
                        {doc.status ?? "PENDING"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <DocumentOpenButton endpoint={`/api/admin/affiliates/documents/${doc.id}/signed-url`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
