'use client';

// CRM Suppression manager — CAN-SPAM / TCPA compliance surface.
// Lists email + SMS suppression entries, supports manual admin suppression,
// and (email only) unsuppression with confirmation. SMS re-enablement is
// intentionally absent: TCPA re-opt-in flows through the START review task.

import { useCallback, useEffect, useState } from 'react';
import { ShieldOff, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Tabs,
  Toolbar,
  SearchField,
  type Column,
} from '@/components/admin/crm/ui';

interface SuppressionRow {
  id: string;
  email?: string;
  phone?: string;
  reason: string;
  suppressed_at: string;
  restarted_at?: string | null;
}

type Channel = 'email' | 'sms';

export default function SuppressionPage() {
  const [channel, setChannel] = useState<Channel>('email');
  const [rows, setRows] = useState<SuppressionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [addValue, setAddValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmAdd, setConfirmAdd] = useState(false);
  const [unsuppress, setUnsuppress] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(
        `/api/admin/crm/suppression?type=${channel}&search=${encodeURIComponent(search)}`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { data: SuppressionRow[]; total: number };
      setRows(json.data);
      setTotal(json.total);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [channel, search]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  async function addSuppression() {
    setAdding(true);
    try {
      const res = await fetch('/api/admin/crm/suppression', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: channel, value: addValue.trim() }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? 'Failed to suppress');
      toast.success(`${channel === 'email' ? 'Email' : 'Phone'} suppressed`);
      setAddValue('');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to suppress');
      throw e;
    } finally {
      setAdding(false);
    }
  }

  const columns: Column<SuppressionRow>[] = [
    {
      id: 'value',
      header: channel === 'email' ? 'Email' : 'Phone',
      cell: (r) => <span className="font-medium">{r.email ?? r.phone}</span>,
      sortable: true,
      sortValue: (r) => r.email ?? r.phone ?? '',
    },
    {
      id: 'reason',
      header: 'Reason',
      cell: (r) => (
        <Badge tone={r.reason === 'admin_added' ? 'neutral' : 'danger'} size="sm">
          {r.reason.replace(/_/g, ' ')}
        </Badge>
      ),
    },
    {
      id: 'suppressed_at',
      header: 'Suppressed',
      cell: (r) => new Date(r.suppressed_at).toLocaleString(),
      sortable: true,
      sortValue: (r) => r.suppressed_at,
    },
    ...(channel === 'sms'
      ? [{
          id: 'restarted',
          header: 'START received',
          cell: (r: SuppressionRow) => (r.restarted_at ? new Date(r.restarted_at).toLocaleDateString() : '—'),
        } satisfies Column<SuppressionRow>]
      : [{
          id: 'actions',
          header: '',
          align: 'right' as const,
          cell: (r: SuppressionRow) => (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setUnsuppress(r.email ?? null)}
              data-testid={`unsuppress-${r.id}`}
            >
              Remove
            </Button>
          ),
        } satisfies Column<SuppressionRow>]),
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6" data-testid="crm-suppression">
      <PageHeader
        title="Suppression"
        subtitle={`Email and SMS suppression list — CAN-SPAM and TCPA compliance surface. ${total} ${channel} entries.`}
        data-testid="crm-suppression-header"
        actions={
          <div className="flex items-center gap-2">
            <input
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              placeholder={channel === 'email' ? 'email@example.com' : '+1 555 000 0000'}
              aria-label={channel === 'email' ? 'Email to suppress' : 'Phone to suppress'}
              className="h-8 w-56 rounded-[var(--crm-radius-sm)] border border-[var(--crm-border-strong)] bg-[var(--crm-bg-primary)] px-2.5 text-[13px] text-[var(--crm-text-primary)] outline-none placeholder:text-[var(--crm-text-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)]"
              data-testid="suppression-add-input"
            />
            <Button
              variant="primary"
              disabled={!addValue.trim() || adding}
              onClick={() => setConfirmAdd(true)}
              data-testid="suppression-add-btn"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> Suppress
            </Button>
          </div>
        }
      />

      <Tabs
        tabs={[
          { id: 'email', label: 'Email', trust: true },
          { id: 'sms', label: 'SMS', trust: true },
        ]}
        value={channel}
        onValueChange={(id) => setChannel(id as Channel)}
        data-testid="suppression-tabs"
      />

      <DataTable<SuppressionRow>
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        loading={loading}
        error={loadError ? (
          <ErrorState title="Failed to load suppression list" onRetry={() => void load()} data-testid="suppression-error" />
        ) : undefined}
        empty={
          <EmptyState
            icon={ShieldOff}
            title={search ? 'No entries match your search' : `No ${channel} suppressions yet`}
            description={channel === 'sms'
              ? 'STOP requests, carrier blocks, and manual suppressions appear here. START does not auto-re-enable — it opens a review task.'
              : 'Unsubscribes, bounces, complaints, and manual suppressions appear here.'}
            data-testid="crm-suppression-empty"
          />
        }
        toolbar={
          <Toolbar>
            <SearchField
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${channel} suppression…`}
              data-testid="suppression-search"
            />
          </Toolbar>
        }
        data-testid="suppression-table"
      />

      <ConfirmDialog
        open={confirmAdd}
        onOpenChange={setConfirmAdd}
        title={`Suppress this ${channel === 'email' ? 'email address' : 'phone number'}?`}
        description={`${addValue.trim()} stops receiving all ${channel === 'email' ? 'marketing email' : 'SMS'} immediately. The suppression is audit-logged.`}
        confirmLabel="Suppress"
        variant="trust"
        onConfirm={addSuppression}
        data-testid="suppression-add-confirm"
      />

      <ConfirmDialog
        open={unsuppress !== null}
        onOpenChange={(open) => { if (!open) setUnsuppress(null); }}
        title="Remove this email from suppression?"
        description={`${unsuppress ?? ''} becomes eligible for email again. Only do this at the recipient's documented request — removal is audit-logged.`}
        confirmLabel="Remove suppression"
        variant="danger"
        onConfirm={async () => {
          const res = await fetch('/api/admin/crm/suppression', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'email', value: unsuppress }),
          });
          if (!res.ok) {
            const json = (await res.json().catch(() => null)) as { error?: string } | null;
            toast.error(json?.error ?? 'Failed to remove suppression');
            throw new Error('failed');
          }
          toast.success('Suppression removed');
          setUnsuppress(null);
          await load();
        }}
        data-testid="suppression-remove-confirm"
      />
    </div>
  );
}
