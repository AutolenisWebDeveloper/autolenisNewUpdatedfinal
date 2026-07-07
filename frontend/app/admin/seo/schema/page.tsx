import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
export const dynamic = "force-dynamic";
export default async function AdminSeoSchemaPage() {
  await requireAdmin();
  // `NOT: { schema: undefined }` was a Prisma no-op that returned every config
  // (including null-schema rows rendered as "null"); filter JSON null properly.
  const configs = await prisma.seoPageConfig.findMany({
    where: { NOT: { schema: { equals: Prisma.DbNull } } },
    orderBy: { pageSlug: "asc" },
  });
  return <div className="p-6 md:p-8 max-w-3xl" data-testid="admin-seo-schema"><h1 className="text-xl font-bold text-slate-900 mb-4">JSON-LD Schema Viewer</h1><p className="text-xs text-slate-500 mb-4">Read-only view of structured data per page. Schema is managed in code (lib/seo).</p>{configs.length === 0 ? (<div className="text-center py-16 text-slate-400 bg-white border border-slate-200 rounded-xl" data-testid="seo-schema-empty"><p className="font-medium text-slate-500">No pages have JSON-LD schema configured</p></div>) : (<div className="space-y-3">{configs.map(c => <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-4"><p className="font-medium text-slate-800 text-sm mb-2">{c.pageSlug}</p><pre className="text-xs text-slate-600 bg-slate-50 rounded p-2 overflow-auto max-h-40">{JSON.stringify(c.schema, null, 2)}</pre></div>)}</div>)}</div>;
}
