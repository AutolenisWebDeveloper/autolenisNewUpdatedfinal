import Link from 'next/link';
import { Filter, Plus, Pencil, Users } from 'lucide-react';
import { getServiceSupabase } from '@/lib/supabase-service';
import { SegmentService } from '@/lib/services/segment.service';
import type { Segment } from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const day = Math.floor(diff / 86_400_000);
  if (day >= 1) return `${day}d ago`;
  const hr = Math.floor(diff / 3_600_000);
  if (hr >= 1) return `${hr}h ago`;
  const min = Math.floor(diff / 60_000);
  if (min >= 1) return `${min}m ago`;
  return 'just now';
}

export default async function SegmentsPage() {
  const supabase = getServiceSupabase();
  let segments: Segment[] = [];
  let loadError: string | null = null;
  try {
    segments = await SegmentService.listSegments(supabase);
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'LOAD_FAILED';
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Filter className="w-5 h-5 text-blue-500" />
            Segments
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Dynamic audiences for campaigns. Counts refresh whenever a rule changes.
          </p>
        </div>
        <Link
          href="/admin/crm/segments/new"
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> New Segment
        </Link>
      </header>

      {loadError ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-300">
          Failed to load segments: {loadError}
        </div>
      ) : segments.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
          <Filter className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-400 font-medium">No segments yet</p>
          <p className="text-xs text-gray-600 mt-1 max-w-sm mx-auto">
            Segments power campaign targeting. Build one with rules like {`"`}lifecycle_stage
            equals deposit_paid{`"`} to bundle a recurring audience.
          </p>
          <Link
            href="/admin/crm/segments/new"
            className="inline-flex items-center gap-1.5 mt-4 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> New Segment
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
                  Rules
                </th>
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                  Contacts
                </th>
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                  Counted
                </th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {segments.map((s) => (
                <tr key={s.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-5 py-3">
                    <Link
                      href={`/admin/crm/segments/${s.id}/edit`}
                      className="text-sm font-medium text-white hover:text-blue-300 transition-colors"
                    >
                      {s.name}
                    </Link>
                    {s.description && (
                      <div className="text-[11px] text-gray-500 mt-0.5 truncate max-w-md">
                        {s.description}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-[11px] text-gray-400">
                    {s.conditions.rules.length} ({s.conditions.match})
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1 text-xs font-mono text-blue-300">
                      <Users className="w-3 h-3" />
                      {s.contact_count.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500">
                    {relativeTime(s.last_counted_at)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/admin/crm/segments/${s.id}/edit`}
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
