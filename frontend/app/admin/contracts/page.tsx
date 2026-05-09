import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
export const dynamic = "force-dynamic";
export default async function AdminContractsPage() {
  await requireAdmin();
  const versions = await prisma.contractVersion.findMany({ orderBy: { uploadedAt: "desc" }, take: 50 });
  return <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-contracts-page"><h1 className="text-xl font-bold text-slate-900 mb-4">Contracts ({versions.length})</h1>{versions.length === 0 ? <p className="text-slate-500 text-sm">No contract versions uploaded.</p> : <div className="space-y-2">{versions.map(v => <div key={v.id} data-testid={`contract-version-${v.id}`} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4"><div><p className="font-medium text-slate-800 text-sm">Deal #{v.dealId.slice(-8)} · v{v.version}</p><p className="text-xs text-slate-400">{v.uploadedAt.toLocaleDateString()}</p></div><Badge variant={v.status === "APPROVED" ? "green" : v.status === "REJECTED" ? "destructive" : "amber"} className="text-xs">{v.status}</Badge></div>)}</div>}</div>;
}
