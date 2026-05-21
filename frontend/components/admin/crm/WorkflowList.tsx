'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Play,
  Pause,
  Copy,
  Trash2,
  Loader2,
  CircleDot,
  CheckCircle2,
  XCircle,
  Plus,
  Wand2,
  Filter as FilterIcon,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Workflow, WorkflowStatus } from '@/lib/types/crm';

type Stats = Record<string, { active: number; completed: number; failed: number }>;

interface PrebuiltSummary {
  key: string;
  category: 'buyer' | 'dealer' | 'affiliate' | 'refinance';
  name: string;
  description: string;
  trigger_type: string;
  node_count: number;
}

const STATUS_TABS: { value: WorkflowStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Drafts' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
];

const STATUS_COLOR: Record<WorkflowStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-500/30',
  draft: 'bg-gray-700/40 text-gray-400 border-gray-300',
  paused: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  archived: 'bg-gray-700/30 text-gray-500 border-gray-200',
};

const CATEGORY_COLOR: Record<PrebuiltSummary['category'], string> = {
  buyer: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  dealer: 'bg-purple-500/10 text-purple-700 border-purple-500/30',
  affiliate: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
  refinance: 'bg-orange-500/10 text-orange-700 border-orange-200',
};

function formatTriggerType(t: string): string {
  return t.replace(/_/g, ' ');
}

export function WorkflowListClient({
  initialWorkflows,
  initialStats,
  prebuilt,
}: {
  initialWorkflows: Workflow[];
  initialStats: Stats;
  prebuilt: PrebuiltSummary[];
}) {
  const [workflows, setWorkflows] = useState(initialWorkflows);
  const [stats] = useState<Stats>(initialStats);
  const [tab, setTab] = useState<WorkflowStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [_pendingTransition, startTransition] = useTransition();
  const router = useRouter();

  const filtered = useMemo(() => {
    return workflows.filter((w) => {
      if (tab !== 'all' && w.status !== tab) return false;
      if (search && !w.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [workflows, tab, search]);

  async function patchStatus(id: string, target: 'activate' | 'pause') {
    setPendingId(id);
    try {
      const res = await fetch(`/api/admin/crm/automations/${id}/${target}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error ?? 'Action failed');
        return;
      }
      setWorkflows((prev) => prev.map((w) => (w.id === id ? (json.workflow as Workflow) : w)));
    } finally {
      setPendingId(null);
    }
  }

  async function duplicate(id: string) {
    setPendingId(id);
    try {
      const res = await fetch('/api/admin/crm/automations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from_prebuilt: undefined, _duplicate_from: id }),
      });
      // Simpler client-side path: read the source then POST a clone payload.
      if (!res.ok) {
        const src = workflows.find((w) => w.id === id);
        if (!src) return;
        const dup = await fetch('/api/admin/crm/automations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: `${src.name} (copy)`,
            description: src.description,
            trigger_type: src.trigger_type,
            trigger_config: src.trigger_config,
            nodes: src.nodes,
          }),
        });
        const dupJson = await dup.json();
        if (dupJson.workflow) {
          startTransition(() => router.refresh());
          setWorkflows((prev) => [dupJson.workflow as Workflow, ...prev]);
        }
        return;
      }
      const json = await res.json();
      if (json.workflow) {
        setWorkflows((prev) => [json.workflow as Workflow, ...prev]);
      }
    } finally {
      setPendingId(null);
    }
  }

  async function remove(id: string) {
    const wf = workflows.find((w) => w.id === id);
    if (!wf) return;
    const isHard = wf.status === 'draft';
    if (
      !confirm(
        isHard
          ? `Delete "${wf.name}"? This cannot be undone.`
          : `Archive "${wf.name}"? Its enrollment history will be retained.`,
      )
    ) return;

    setPendingId(id);
    try {
      const res = await fetch(`/api/admin/crm/automations/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        alert(json.error ?? 'Delete failed');
        return;
      }
      if (isHard) {
        setWorkflows((prev) => prev.filter((w) => w.id !== id));
      } else {
        setWorkflows((prev) =>
          prev.map((w) => (w.id === id ? { ...w, status: 'archived' as WorkflowStatus } : w)),
        );
      }
    } finally {
      setPendingId(null);
    }
  }

  async function cloneFromPrebuilt(key: string) {
    const p = prebuilt.find((x) => x.key === key);
    if (!p) return;
    const res = await fetch('/api/admin/crm/automations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from_prebuilt: key }),
    });
    const json = await res.json();
    if (json.workflow) {
      router.push(`/admin/crm/automations/${json.workflow.id}/edit`);
    } else {
      alert(json.error ?? 'Clone failed');
    }
  }

  return (
    <>
      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={cn(
                'text-xs font-medium px-3 py-1.5 rounded-md transition-colors',
                tab === t.value
                  ? 'bg-blue-600 text-gray-900'
                  : 'text-gray-500 hover:text-gray-400',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search workflows…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-white border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm w-72 focus:border-blue-500 outline-none transition-colors"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowLibrary((s) => !s)}
          className={cn(
            'ml-auto border text-sm px-4 py-2 rounded-lg flex items-center gap-2 transition-colors',
            showLibrary
              ? 'border-blue-500 text-blue-600 bg-blue-500/10'
              : 'border-gray-300 hover:border-gray-400 text-gray-500',
          )}
        >
          <Wand2 className="w-4 h-4" />
          Prebuilt library
        </button>
      </div>

      {showLibrary && (
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Prebuilt automations</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Clone to a draft. You will be taken into the editor to customize before activation.
              </p>
            </div>
            <span className="text-[11px] text-gray-500">{prebuilt.length} templates</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {prebuilt.map((p) => (
              <div
                key={p.key}
                className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-gray-900">{p.name}</h3>
                  <span
                    className={cn(
                      'text-[10px] font-semibold px-2 py-0.5 rounded border uppercase tracking-wider',
                      CATEGORY_COLOR[p.category],
                    )}
                  >
                    {p.category}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mb-3 line-clamp-2">{p.description}</p>
                <div className="text-[11px] text-gray-500 mb-3 flex items-center gap-3">
                  <span>Trigger: {formatTriggerType(p.trigger_type)}</span>
                  <span>·</span>
                  <span>{p.node_count} nodes</span>
                </div>
                <button
                  type="button"
                  onClick={() => cloneFromPrebuilt(p.key)}
                  className="w-full text-xs font-medium bg-gray-50 hover:bg-gray-700 text-gray-900 px-3 py-1.5 rounded-md transition-colors"
                >
                  Use this workflow
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 flex flex-col items-center text-center">
          <FilterIcon className="w-10 h-10 text-gray-500 mb-3" />
          <p className="text-sm text-gray-500">
            {workflows.length === 0
              ? 'No workflows yet. Start from a prebuilt template or build your own.'
              : 'No workflows match your filters.'}
          </p>
          {workflows.length === 0 && (
            <Link
              href="/admin/crm/automations/new"
              className="mt-4 text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Create your first workflow
            </Link>
          )}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                <th className="px-5 py-3">Workflow</th>
                <th className="px-5 py-3">Trigger</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Enrollments</th>
                <th className="px-5 py-3">Updated</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filtered.map((w) => {
                const s = stats[w.id] ?? { active: 0, completed: 0, failed: 0 };
                const isPending = pendingId === w.id;
                return (
                  <tr key={w.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/crm/automations/${w.id}/edit`}
                        className="text-sm text-gray-900 hover:text-blue-600 font-medium"
                      >
                        {w.name}
                      </Link>
                      {w.description && (
                        <div className="text-[11px] text-gray-500 line-clamp-1 mt-0.5">
                          {w.description}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-500">
                      {formatTriggerType(w.trigger_type)}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          'text-[10px] font-semibold px-2 py-0.5 rounded border uppercase tracking-wider',
                          STATUS_COLOR[w.status],
                        )}
                      >
                        {w.status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3 text-[11px] text-gray-500">
                        <span className="flex items-center gap-1">
                          <CircleDot className="w-3 h-3 text-blue-600" />
                          {s.active}
                        </span>
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                          {s.completed}
                        </span>
                        <span className="flex items-center gap-1">
                          <XCircle className="w-3 h-3 text-red-600" />
                          {s.failed}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-[11px] text-gray-500">
                      {new Date(w.updated_at).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {w.status === 'active' ? (
                          <button
                            type="button"
                            onClick={() => patchStatus(w.id, 'pause')}
                            disabled={isPending}
                            className="text-[11px] text-yellow-700 hover:text-yellow-700 px-2 py-1 rounded hover:bg-yellow-50 flex items-center gap-1 disabled:opacity-50"
                            title="Pause"
                          >
                            {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Pause className="w-3 h-3" />}
                            Pause
                          </button>
                        ) : w.status !== 'archived' ? (
                          <button
                            type="button"
                            onClick={() => patchStatus(w.id, 'activate')}
                            disabled={isPending}
                            className="text-[11px] text-emerald-700 hover:text-emerald-700 px-2 py-1 rounded hover:bg-emerald-500/10 flex items-center gap-1 disabled:opacity-50"
                            title="Activate"
                          >
                            {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                            Activate
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => duplicate(w.id)}
                          disabled={isPending}
                          className="text-[11px] text-gray-500 hover:text-gray-400 px-2 py-1 rounded hover:bg-gray-100 flex items-center gap-1 disabled:opacity-50"
                          title="Duplicate"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(w.id)}
                          disabled={isPending}
                          className="text-[11px] text-red-600/80 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 flex items-center gap-1 disabled:opacity-50"
                          title={w.status === 'draft' ? 'Delete' : 'Archive'}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
