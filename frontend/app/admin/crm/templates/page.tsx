import Link from 'next/link';
import { FileText, Plus, Pencil, Tag } from 'lucide-react';
import { getServiceSupabase } from '@/lib/supabase-service';
import { TemplateService } from '@/lib/services/template.service';
import type { EmailTemplate, EmailTemplateStatus } from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<EmailTemplateStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-400',
  draft: 'bg-yellow-500/15 text-yellow-400',
  inactive: 'bg-gray-700/50 text-gray-500',
};

const CATEGORY_LABEL: Record<string, string> = {
  transactional: 'Transactional',
  marketing: 'Marketing',
  automation: 'Automation',
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const day = Math.floor(diff / 86_400_000);
  if (day >= 1) return `${day}d ago`;
  const hr = Math.floor(diff / 3_600_000);
  if (hr >= 1) return `${hr}h ago`;
  const min = Math.floor(diff / 60_000);
  if (min >= 1) return `${min}m ago`;
  return 'just now';
}

export default async function TemplatesPage() {
  const supabase = getServiceSupabase();
  let templates: EmailTemplate[] = [];
  let loadError: string | null = null;
  try {
    templates = await TemplateService.listTemplates(supabase, {});
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'LOAD_FAILED';
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-500" />
            Email Templates
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Versioned, variable-substituted templates with CAN-SPAM footer enforcement.
          </p>
        </div>
        <Link
          href="/admin/crm/templates/new"
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> New Template
        </Link>
      </header>

      {loadError ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-300">
          Failed to load templates: {loadError}
        </div>
      ) : templates.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
          <FileText className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-400 font-medium">No templates yet</p>
          <p className="text-xs text-gray-600 mt-1 max-w-sm mx-auto">
            Templates power transactional emails, marketing campaigns, and automation
            workflows. Create your first to get started.
          </p>
          <Link
            href="/admin/crm/templates/new"
            className="inline-flex items-center gap-1.5 mt-4 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> New Template
          </Link>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                  Name
                </th>
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                  Category
                </th>
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                  Status
                </th>
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                  Version
                </th>
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                  Updated
                </th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {templates.map((t) => (
                <tr key={t.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-5 py-3">
                    <Link
                      href={`/admin/crm/templates/${t.id}/edit`}
                      className="text-sm font-medium text-white hover:text-blue-300 transition-colors"
                    >
                      {t.name}
                    </Link>
                    <div className="text-[11px] text-gray-500 mt-0.5 truncate max-w-md">
                      {t.subject}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                      <Tag className="w-3 h-3" />
                      {CATEGORY_LABEL[t.category] ?? t.category}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${STATUS_BADGE[t.status]}`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-400 font-mono">v{t.version}</td>
                  <td className="px-5 py-3 text-xs text-gray-500">{relativeTime(t.updated_at)}</td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/admin/crm/templates/${t.id}/edit`}
                      className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </Link>
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
