import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function AdminSeoSchemaPage() {
  await requireAdmin();
  const configs = await prisma.seoPageConfig.findMany({ where: { NOT: { schema: undefined } } });
  return <div className="p-6 md:p-8 max-w-3xl" data-testid="admin-seo-schema"><h1 className="text-xl font-bold text-slate-900 mb-4">JSON-LD Schema Editor</h1><div className="space-y-3">{configs.map(c => <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-4"><p className="font-medium text-slate-800 text-sm mb-2">{c.pageSlug}</p><pre className="text-xs text-slate-600 bg-slate-50 rounded p-2 overflow-auto max-h-40">{JSON.stringify(c.schema, null, 2)}</pre></div>)}</div></div>;
}
