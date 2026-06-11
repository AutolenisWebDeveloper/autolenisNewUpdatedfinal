'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Send, Plus, Mail, MessageSquare, Layers, AlertTriangle } from 'lucide-react';
import type { Campaign, CampaignStatus, CampaignType } from '@/lib/types/crm';
import {
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  StatusPill,
  Toolbar,
  SearchField,
  SelectField,
  type Column,
  type Tone,
} from './ui';

// Status → semantic tone. Mirrors the legacy colour intent (draft grey,
// scheduled blue, running active, paused amber, completed green, cancelled red).
const STATUS_TONE: Record<CampaignStatus, Tone> = {
  draft: 'neutral',
  scheduled: 'info',
  running: 'primary',
  paused: 'warning',
  completed: 'success',
  cancelled: 'danger',
};

const TYPE_ICON: Record<CampaignType, typeof Mail> = {
  email: Mail,
  sms: MessageSquare,
  mixed: Layers,
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) {
    const min = Math.floor(-diff / 60_000);
    if (min < 60) return `in ${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `in ${hr}h`;
    return `in ${Math.floor(hr / 24)}d`;
  }
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function CampaignListClient({
  campaigns,
  loadError,
}: {
  campaigns: Campaign[];
  loadError: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<CampaignType | ''>('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false;
      if (typeFilter && c.type !== typeFilter) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [campaigns, query, statusFilter, typeFilter]);

  const filterActive = !!query.trim() || !!statusFilter || !!typeFilter;

  const columns: Column<Campaign>[] = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      sortValue: (c) => c.name.toLowerCase(),
      cell: (c) => (
        <Link
          href={`/admin/crm/campaigns/${c.id}`}
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-[var(--crm-text-primary)] hover:text-[var(--crm-primary)]"
          data-testid="crm-campaign-name"
        >
          {c.name}
        </Link>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      sortable: true,
      sortValue: (c) => c.type,
      cell: (c) => {
        const Icon = TYPE_ICON[c.type];
        return (
          <span className="inline-flex items-center gap-1 text-[12px] capitalize text-[var(--crm-text-tertiary)]">
            <Icon className="h-3 w-3" />
            {c.type}
          </span>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (c) => c.status,
      cell: (c) => (
        <StatusPill tone={STATUS_TONE[c.status]} size="sm" className="capitalize" data-testid="crm-campaign-status">
          {c.status}
        </StatusPill>
      ),
    },
    {
      id: 'recipients',
      header: 'Recipients',
      align: 'right',
      sortable: true,
      sortValue: (c) => c.recipient_count,
      cell: (c) => (
        <span className="tabular-nums text-[var(--crm-text-secondary)]">
          {c.recipient_count.toLocaleString()}
        </span>
      ),
    },
    {
      id: 'sent',
      header: 'Sent',
      align: 'right',
      sortable: true,
      sortValue: (c) => c.sent_count,
      cell: (c) => (
        <span className="tabular-nums text-[var(--crm-text-secondary)]">
          {c.sent_count.toLocaleString()}
        </span>
      ),
    },
    {
      id: 'created',
      header: 'Created',
      align: 'right',
      sortable: true,
      sortValue: (c) => new Date(c.created_at).getTime(),
      cell: (c) => (
        <span className="text-[12px] text-[var(--crm-text-tertiary)]">{relativeTime(c.created_at)}</span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6" data-testid="crm-campaigns">
      <PageHeader
        title="Campaigns"
        subtitle="Email + SMS sends to dynamic audiences. Fan-out runs on Inngest."
        data-testid="crm-campaigns-header"
        actions={
          <Link href="/admin/crm/campaigns/new" data-testid="crm-campaigns-new">
            <Button variant="primary">
              <Plus className="h-4 w-4" /> New campaign
            </Button>
          </Link>
        }
      />

      <DataTable
        data-testid="crm-campaigns-table"
        columns={columns}
        rows={rows}
        getRowId={(c) => c.id}
        onSelect={(c) => router.push(`/admin/crm/campaigns/${c.id}`)}
        toolbar={
          <Toolbar data-testid="crm-campaigns-toolbar">
            <SearchField
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name…"
              data-testid="crm-campaigns-search"
            />
            <SelectField
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as CampaignType | '')}
              data-testid="crm-campaigns-type-filter"
            >
              <option value="">All types</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="mixed">Email + SMS</option>
            </SelectField>
            <SelectField
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CampaignStatus | '')}
              data-testid="crm-campaigns-status-filter"
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="running">Running</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </SelectField>
          </Toolbar>
        }
        error={
          loadError ? (
            <EmptyState
              icon={AlertTriangle}
              variant="error"
              title="Failed to load campaigns"
              description={loadError}
              data-testid="crm-campaigns-error"
            />
          ) : undefined
        }
        empty={
          <EmptyState
            icon={Send}
            title={filterActive ? 'No campaigns match your filters' : 'No campaigns yet'}
            description={
              filterActive
                ? 'Try adjusting your search or filters.'
                : 'Campaigns send to a segment using one template (email) or message body (SMS), with suppression + DNC + consent gates enforced at fan-out time.'
            }
            data-testid="crm-campaigns-empty"
            action={
              !filterActive ? (
                <Link href="/admin/crm/campaigns/new" data-testid="crm-campaigns-empty-new">
                  <Button variant="primary">
                    <Plus className="h-4 w-4" /> New campaign
                  </Button>
                </Link>
              ) : undefined
            }
          />
        }
      />
    </div>
  );
}
