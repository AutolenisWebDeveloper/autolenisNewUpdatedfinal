'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  UserPlus,
  Upload,
  RefreshCcw,
} from 'lucide-react';
import { useDebounce } from '@/lib/hooks/use-debounce';
import type { Contact, LifecycleStage } from '@/lib/types/crm';
import { StageBadge, STAGE_OPTIONS } from './StageBadge';
import { AddContactModal } from './AddContactModal';
import { ImportContactsModal } from './ImportContactsModal';
import { BulkComposeEmailModal } from './BulkComposeEmailModal';
import { BulkComposeSmsModal } from './BulkComposeSmsModal';

type Props = {
  pageTitle?: string;
  pageDescription?: string;
  lockedStages?: LifecycleStage[];
};

type Toast = { kind: 'success' | 'error'; text: string } | null;

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
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkEmailOpen, setBulkEmailOpen] = useState(false);
  const [bulkSmsOpen, setBulkSmsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

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
  }, [debouncedQuery, stageFilter, page, lockedStages, refreshKey]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

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

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  async function bulkDelete() {
    const ids = Array.from(selected);
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/admin/crm/contacts/${id}`, { method: 'DELETE' }).catch(() => null),
      ),
    );
    setSelected(new Set());
    setConfirmDelete(false);
    refresh();
    router.refresh();
  }

  async function syncExisting() {
    setSyncing(true);
    try {
      const res = await fetch('/api/admin/crm/contacts/backfill', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setToast({ kind: 'error', text: json.error ?? 'SYNC_FAILED' });
      } else {
        setToast({
          kind: 'success',
          text: `Synced ${json.buyers_synced} buyers, ${json.dealers_synced} dealers, ${json.affiliates_synced} affiliates`,
        });
        refresh();
      }
    } catch (err) {
      setToast({
        kind: 'error',
        text: err instanceof Error ? err.message : 'SYNC_FAILED',
      });
    } finally {
      setSyncing(false);
    }
  }

  const startRow = total === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const endRow = Math.min(total, page * PER_PAGE);
  const filterActive = !!debouncedQuery.trim() || !!stageFilter;
  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  return (
    <div className="p-6 space-y-5">
      <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{pageTitle}</h1>
          <p className="text-sm text-gray-500 mt-1">{pageDescription}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {total > 0 && (
            <span className="text-xs text-gray-500 hidden md:inline">
              Showing <span className="text-gray-900 font-medium">{startRow}–{endRow}</span> of{' '}
              <span className="text-gray-900 font-medium">{total}</span>
            </span>
          )}
          <button
            onClick={syncExisting}
            disabled={syncing}
            className="flex items-center gap-1.5 text-sm bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
          >
            {syncing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCcw className="w-4 h-4" />
            )}
            Sync existing records
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-1.5 text-sm bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg px-3 py-2 transition-colors"
          >
            <Upload className="w-4 h-4" /> Import CSV
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 transition-colors"
          >
            <UserPlus className="w-4 h-4" /> Add Contact
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, or phone…"
            className="w-full bg-white border border-gray-300 hover:border-gray-400 focus:border-blue-500 outline-none rounded-lg pl-10 pr-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors"
          />
        </div>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value as LifecycleStage | '')}
          className="bg-white border border-gray-300 hover:border-gray-400 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-gray-900 transition-colors"
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
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-20 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="py-20 text-center">
            <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-700 font-medium">No contacts found</p>
            <p className="text-xs text-gray-500 mt-1">
              {filterActive
                ? 'Try adjusting your filters or search query.'
                : 'Contacts will appear here as buyers, dealers, and leads sign up.'}
            </p>
            {!filterActive && (
              <button
                onClick={syncExisting}
                className="mt-4 text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Sync existing buyers, dealers, and affiliates →
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="px-4 py-3 text-left">Contact</th>
                <th className="px-4 py-3 text-left">Phone</th>
                <th className="px-4 py-3 text-left">Source</th>
                <th className="px-4 py-3 text-left">Stage</th>
                <th className="px-4 py-3 text-left">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {contacts.map((c) => {
                const name =
                  [c.first_name, c.last_name].filter(Boolean).join(' ') ||
                  c.email ||
                  c.phone ||
                  'Unknown';
                return (
                  <tr
                    key={c.id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => router.push(`/admin/crm/contacts/${c.id}`)}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleOne(c.id)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-semibold text-white shrink-0">
                          {(c.first_name?.[0] ?? c.email?.[0] ?? '?').toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-gray-900 font-medium truncate">{name}</div>
                          <div className="text-xs text-gray-500 truncate">{c.email ?? '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 tabular-nums">
                      {formatPhone(c.phone)}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{c.source}</td>
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
          <div className="text-xs text-gray-500">
            Page <span className="text-gray-900 font-medium">{page}</span> of{' '}
            <span className="text-gray-900 font-medium">{totalPages}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {someSelected && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 flex items-center gap-3">
          <span className="text-sm text-gray-900">
            <span className="font-semibold">{selected.size}</span> selected
          </span>
          <span className="text-gray-300">·</span>
          <button
            onClick={() => setBulkEmailOpen(true)}
            className="flex items-center gap-1.5 text-sm text-gray-700 hover:text-gray-900"
          >
            <Mail className="w-4 h-4" /> Email
          </button>
          <button
            onClick={() => setBulkSmsOpen(true)}
            className="flex items-center gap-1.5 text-sm text-gray-700 hover:text-gray-900"
          >
            <MessageSquare className="w-4 h-4" /> SMS
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700"
          >
            <Trash2 className="w-4 h-4" /> Delete
          </button>
          <span className="text-gray-300">·</span>
          <button
            onClick={() => setSelected(new Set())}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-md w-full shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">
              Delete {selected.size} contact{selected.size === 1 ? '' : 's'}?
            </h3>
            <p className="text-sm text-gray-500 mt-2">
              This will soft-delete the selected contacts. They will be hidden from lists but can
              be restored by an admin if needed.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={bulkDelete}
                className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Delete {selected.size} contact{selected.size === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {addOpen && (
        <AddContactModal
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setToast({ kind: 'success', text: 'Contact added' });
            refresh();
          }}
        />
      )}
      {importOpen && (
        <ImportContactsModal
          onClose={() => setImportOpen(false)}
          onImported={(r) => {
            setToast({
              kind: 'success',
              text: `Imported ${r.imported}, merged ${r.duplicates_merged}, ${r.errors} errors`,
            });
            refresh();
          }}
        />
      )}
      {bulkEmailOpen && (
        <BulkComposeEmailModal
          contactIds={selectedIds}
          onClose={() => setBulkEmailOpen(false)}
          onSent={(n) => {
            setToast({ kind: 'success', text: `Queued ${n} emails` });
            setSelected(new Set());
          }}
        />
      )}
      {bulkSmsOpen && (
        <BulkComposeSmsModal
          contactIds={selectedIds}
          onClose={() => setBulkSmsOpen(false)}
          onSent={(n) => {
            setToast({ kind: 'success', text: `Queued ${n} SMS messages` });
            setSelected(new Set());
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-20 right-6 z-50 max-w-sm rounded-lg shadow-lg px-4 py-3 border text-sm font-medium ${
            toast.kind === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
