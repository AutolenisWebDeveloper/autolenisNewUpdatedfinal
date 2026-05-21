'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Users,
  Loader2,
  Trash2,
  Mail,
  MessageSquare,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useDebounce } from '@/lib/hooks/use-debounce';
import type { Contact, LifecycleStage } from '@/lib/types/crm';
import { StageBadge, STAGE_OPTIONS } from './StageBadge';

type Props = {
  pageTitle?: string;
  pageDescription?: string;
  lockedStages?: LifecycleStage[];
};

const PER_PAGE = 50;

function formatPhone(phone: string | null): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function ContactList({
  pageTitle = 'Contacts',
  pageDescription = 'Everyone in the AutoLenis universe — buyers, dealers, affiliates, leads.',
  lockedStages,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const [stageFilter, setStageFilter] = useState<LifecycleStage | ''>(
    lockedStages && lockedStages.length === 1 ? lockedStages[0] : '',
  );
  const [page, setPage] = useState(1);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const stageOptions = useMemo(() => {
    if (!lockedStages) return STAGE_OPTIONS;
    return STAGE_OPTIONS.filter((opt) => lockedStages.includes(opt.value));
  }, [lockedStages]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, stageFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());

    if (stageFilter) {
      params.set('stage', stageFilter);
    } else if (lockedStages && lockedStages.length > 1) {
      // Multi-stage lock: filter client-side after fetch (best-effort).
    }
    params.set('page', String(page));
    params.set('per_page', String(PER_PAGE));

    fetch(`/api/admin/crm/contacts?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        let rows = (json.data as Contact[]) ?? [];
        let totalCount = Number(json.total ?? 0);
        if (lockedStages && lockedStages.length > 1 && !stageFilter) {
          rows = rows.filter((c) => lockedStages.includes(c.lifecycle_stage));
          totalCount = rows.length;
        }
        setContacts(rows);
        setTotal(totalCount);
      })
      .catch(() => {
        if (!cancelled) {
          setContacts([]);
          setTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, stageFilter, page, lockedStages]);

  const allSelected = contacts.length > 0 && contacts.every((c) => selected.has(c.id));
  const someSelected = selected.size > 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(contacts.map((c) => c.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/admin/crm/contacts/${id}`, { method: 'DELETE' }).catch(() => null),
      ),
    );
    setSelected(new Set());
    setConfirmDelete(false);
    setLoading(true);
    router.refresh();
    // Re-fetch by bumping a state — simplest is to refetch via page reset.
    setPage((p) => p);
    const params = new URLSearchParams();
    if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
    if (stageFilter) params.set('stage', stageFilter);
    params.set('page', String(page));
    params.set('per_page', String(PER_PAGE));
    const json = await fetch(`/api/admin/crm/contacts?${params.toString()}`).then((r) => r.json());
    setContacts((json.data as Contact[]) ?? []);
    setTotal(Number(json.total ?? 0));
    setLoading(false);
  }

  const startRow = total === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const endRow = Math.min(total, page * PER_PAGE);
  const filterActive = !!debouncedQuery.trim() || !!stageFilter;

  return (
    <div className="p-6 space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">{pageTitle}</h1>
          <p className="text-sm text-gray-500 mt-1">{pageDescription}</p>
        </div>
        <div className="text-xs text-gray-600">
          {total > 0 && (
            <span>
              Showing <span className="text-gray-300">{startRow}–{endRow}</span> of{' '}
              <span className="text-gray-300">{total}</span>
            </span>
          )}
        </div>
      </header>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, or phone…"
            className="w-full bg-gray-900 border border-gray-800 hover:border-gray-700 focus:border-blue-500 outline-none rounded-lg pl-10 pr-3 py-2 text-sm text-white placeholder-gray-600 transition-colors"
          />
        </div>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value as LifecycleStage | '')}
          className="bg-gray-900 border border-gray-800 hover:border-gray-700 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-white transition-colors"
          disabled={lockedStages && lockedStages.length === 1}
        >
          <option value="">All stages</option>
          {stageOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-20 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="py-20 text-center">
            <Users className="w-12 h-12 text-gray-700 mx-auto mb-3" />
            <p className="text-sm text-gray-400 font-medium">No contacts found</p>
            <p className="text-xs text-gray-600 mt-1">
              {filterActive
                ? 'Try adjusting your filters or search query.'
                : 'Contacts will appear here as buyers, dealers, and leads sign up.'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-950/50">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-gray-700 bg-gray-900 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="px-4 py-3 text-left">Contact</th>
                <th className="px-4 py-3 text-left">Phone</th>
                <th className="px-4 py-3 text-left">Source</th>
                <th className="px-4 py-3 text-left">Stage</th>
                <th className="px-4 py-3 text-left">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {contacts.map((c) => {
                const name =
                  [c.first_name, c.last_name].filter(Boolean).join(' ') ||
                  c.email ||
                  c.phone ||
                  'Unknown';
                return (
                  <tr
                    key={c.id}
                    className="hover:bg-gray-800/30 cursor-pointer transition-colors"
                    onClick={() => router.push(`/admin/crm/contacts/${c.id}`)}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleOne(c.id)}
                        className="rounded border-gray-700 bg-gray-900 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center text-xs font-semibold text-white shrink-0">
                          {(c.first_name?.[0] ?? c.email?.[0] ?? '?').toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-white font-medium truncate">{name}</div>
                          <div className="text-xs text-gray-500 truncate">{c.email ?? '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400 tabular-nums">
                      {formatPhone(c.phone)}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{c.source}</td>
                    <td className="px-4 py-3">
                      <StageBadge stage={c.lifecycle_stage} />
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(c.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {!loading && contacts.length > 0 && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-600">
            Page <span className="text-gray-300">{page}</span> of{' '}
            <span className="text-gray-300">{totalPages}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-800/60 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-800/60 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {someSelected && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3">
          <span className="text-sm text-white">
            <span className="font-semibold">{selected.size}</span> selected
          </span>
          <span className="text-gray-700">·</span>
          <button className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white">
            <Mail className="w-4 h-4" /> Email
          </button>
          <button className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white">
            <MessageSquare className="w-4 h-4" /> SMS
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300"
          >
            <Trash2 className="w-4 h-4" /> Delete
          </button>
          <span className="text-gray-700">·</span>
          <button
            onClick={() => setSelected(new Set())}
            className="text-sm text-gray-500 hover:text-gray-300 flex items-center gap-1"
          >
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md w-full">
            <h3 className="text-base font-semibold text-white">
              Delete {selected.size} contact{selected.size === 1 ? '' : 's'}?
            </h3>
            <p className="text-sm text-gray-400 mt-2">
              This will soft-delete the selected contacts. They will be hidden from lists but can
              be restored by an admin if needed.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={bulkDelete}
                className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
              >
                Delete {selected.size} contact{selected.size === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
