import { requireAdmin } from "@/lib/auth/admin-session";
import { getAllPageConfigs } from "@/lib/services/seo/seo.service";
export const dynamic = "force-dynamic";
export default async function AdminSeoPagesPage() {
  await requireAdmin();
  const configs = await getAllPageConfigs();
  return <div className="p-6 md:p-8 max-w-4xl" data-testid="admin-seo-pages"><h1 className="text-xl font-bold text-slate-900 mb-4">SEO Page Configs ({configs.length})</h1><div className="space-y-2">{configs.map(c => <div key={c.id} data-testid={`seo-config-${c.id}`} className="bg-white border border-slate-200 rounded-xl p-4"><div className="flex items-center justify-between"><p className="font-medium text-slate-800 text-sm">{c.pageSlug}</p>{c.healthScore !== null && <span className="text-xs font-bold">{c.healthScore}/100</span>}</div>{c.title && <p className="text-xs text-slate-500 mt-0.5">{c.title}</p>}</div>)}</div></div>;
}
