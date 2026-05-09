import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function AdminSeoKeywordsPage() {
  await requireAdmin();
  const keywords = await prisma.seoKeyword.findMany({ where: { isActive: true }, orderBy: { createdAt: "desc" } });
  return <div className="p-6 md:p-8 max-w-3xl" data-testid="admin-seo-keywords"><h1 className="text-xl font-bold text-slate-900 mb-4">SEO Keywords ({keywords.length})</h1>{keywords.length === 0 ? <p className="text-slate-500 text-sm">No keywords tracked yet.</p> : <div className="space-y-2">{keywords.map(k => <div key={k.id} className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex justify-between items-center"><p className="font-medium text-slate-800 text-sm">{k.keyword}</p><p className="text-xs text-slate-400">{k.searchVolume ? `${k.searchVolume.toLocaleString()} vol` : "—"}</p></div>)}</div>}</div>;
}
