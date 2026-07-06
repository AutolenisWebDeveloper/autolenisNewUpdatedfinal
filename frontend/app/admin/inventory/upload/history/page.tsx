import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, History, CheckCircle2, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminInventoryUploadHistoryPage() {
  await requireAdmin();
  const batches = await prisma.inventoryUploadBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="admin-inventory-history-page">
      <div className="mb-6">
        <Link href="/admin/inventory/upload" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 mb-3">
          <ArrowLeft size={14} /> Back to bulk upload
        </Link>
        <div className="flex items-center gap-2">
          <History size={20} className="text-al-primary" />
          <h1 className="text-2xl font-bold text-slate-900">Upload History</h1>
        </div>
        <p className="text-sm text-slate-500 mt-1">{batches.length} past upload batch{batches.length === 1 ? "" : "es"}</p>
      </div>

      {batches.length === 0 ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-xl">
          <History size={28} className="mx-auto text-slate-300 mb-2" />
          <p className="text-sm text-slate-500">No upload history yet</p>
          <Link href="/admin/inventory/upload" className="text-xs text-al-primary font-semibold mt-2 inline-block">Run your first upload</Link>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-xs" data-testid="history-table">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Admin</th>
                <th className="px-4 py-3 font-semibold">File</th>
                <th className="px-4 py-3 font-semibold">Total</th>
                <th className="px-4 py-3 font-semibold text-green-600">Success</th>
                <th className="px-4 py-3 font-semibold text-red-600">Failed</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {batches.map(b => (
                <tr key={b.id} data-testid={`history-row-${b.id}`} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="px-4 py-3 text-slate-700">{new Date(b.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-700">{b.adminEmail}</td>
                  <td className="px-4 py-3 font-mono text-slate-500">{b.filename ?? "—"}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{b.totalRows}</td>
                  <td className="px-4 py-3 text-green-700 font-semibold">{b.successCount}</td>
                  <td className="px-4 py-3 text-red-700 font-semibold">{b.failureCount}</td>
                  <td className="px-4 py-3">
                    {b.failureCount === 0 ? (
                      <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 size={12} /> {b.status}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-700"><AlertCircle size={12} /> partial</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
