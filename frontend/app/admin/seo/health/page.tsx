import { requireAdmin } from "@/lib/auth/admin-session";
import { PAGE_METADATA } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

interface PageMeta {
  title: string;
  description: string;
  path: string;
  keywords?: readonly string[];
}

export default async function AdminSeoHealthPage() {
  await requireAdmin();
  const pages = Object.entries(PAGE_METADATA) as [string, PageMeta][];

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-seo-health">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">
          SEO Health — {pages.length} Pages
        </h1>
        <span className="text-xs text-slate-400">
          Source: <span className="font-mono">lib/seo/metadata.ts</span>
        </span>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="text-left px-5 py-3">Key</th>
              <th className="text-left px-5 py-3">Title</th>
              <th className="text-left px-5 py-3">Description</th>
              <th className="text-left px-5 py-3">Path</th>
              <th className="text-left px-5 py-3">Keywords</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pages.map(([key, meta]) => (
              <tr key={key} className="hover:bg-[#F8FAFF]" data-testid={`seo-health-${key}`}>
                <td className="px-5 py-3 font-mono text-xs text-slate-500">{key}</td>
                <td className="px-5 py-3 text-slate-700 max-w-xs truncate">{meta.title}</td>
                <td className="px-5 py-3 text-slate-500 max-w-sm truncate text-xs">{meta.description}</td>
                <td className="px-5 py-3 font-mono text-xs text-[#0B5FD1]">{meta.path}</td>
                <td className="px-5 py-3 text-xs text-slate-500">{meta.keywords?.length ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400 mt-4">
        Each page has title, description, canonical URL, OpenGraph tags, and Twitter card metadata.
        Run a full audit to capture per-page health scores.
      </p>
    </div>
  );
}
