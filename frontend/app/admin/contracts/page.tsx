import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import DocumentOpenButton from "@/components/admin/DocumentOpenButton";
export const dynamic = "force-dynamic";
export default async function AdminContractsPage() {
  await requireAdmin();
  let versions: Awaited<ReturnType<typeof prisma.contractVersion.findMany>> = [];
  let loadError = false;
  try {
    versions = await prisma.contractVersion.findMany({ orderBy: { uploadedAt: "desc" }, take: 50 });
  } catch {
    loadError = true;
  }
  return <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-contracts-page"><h1 className="text-xl font-bold text-slate-900 mb-4">Contracts ({versions.length})</h1>
    {loadError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-4 mb-4" data-testid="contracts-load-error">Contract versions could not be loaded — reload to retry.</p>}
    {!loadError && versions.length === 0 ? <p className="text-slate-500 text-sm">No contract versions uploaded.</p> : <div className="space-y-2">{versions.map(v => <div key={v.id} data-testid={`contract-version-${v.id}`} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4"><div><Link href={`/admin/deals/${v.dealId}`} className="font-medium text-slate-800 text-sm hover:text-al-primary">Deal #{v.dealId.slice(-8)} · v{v.version}</Link><p className="text-xs text-slate-400">{v.uploadedAt.toLocaleDateString()}</p></div><div className="flex items-center gap-3"><Badge variant={v.status === "APPROVED" ? "green" : v.status === "REJECTED" ? "destructive" : "amber"} className="text-xs">{v.status}</Badge><DocumentOpenButton endpoint={`/api/admin/contracts/${v.id}/signed-url`} label="View" /></div></div>)}</div>}</div>;
}
