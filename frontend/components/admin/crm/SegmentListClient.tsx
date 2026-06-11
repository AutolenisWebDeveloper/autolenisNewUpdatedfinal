'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Filter, Plus, Pencil, Users, AlertTriangle } from 'lucide-react';
import type { Segment } from '@/lib/types/crm';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  Toolbar,
  SearchField,
  type Column,
} from './ui';

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

export function SegmentListClient({
  segments,
  loadError,
}: {
  segments: Segment[];
  loadError: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return segments;
    return segments.filter((s) => `${s.name} ${s.description ?? ''}`.toLowerCase().includes(q));
  }, [segments, query]);

  const filterActive = !!query.trim();

  const columns: Column<Segment>[] = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      sortValue: (s) => s.name.toLowerCase(),
      cell: (s) => (
        <div className="min-w-0">
          <Link
            href={`/admin/crm/segments/${s.id}/edit`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-[var(--crm-text-primary)] hover:text-[var(--crm-primary)]"
            data-testid="crm-segment-name"
          >
            {s.name}
          </Link>
          {s.description && (
            <div className="mt-0.5 max-w-md truncate text-[12px] text-[var(--crm-text-tertiary)]">
              {s.description}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'rules',
      header: 'Rules',
      sortable: true,
      sortValue: (s) => s.conditions.rules.length,
      cell: (s) => (
        <span className="text-[12px] text-[var(--crm-text-tertiary)]">
          {s.conditions.rules.length} ({s.conditions.match})
        </span>
      ),
    },
    {
      id: 'contacts',
      header: 'Contacts',
      align: 'right',
      sortable: true,
      sortValue: (s) => s.contact_count,
      cell: (s) => (
        <Badge tone="primary" size="sm" data-testid="crm-segment-count">
          <Users className="h-3 w-3" />
          {s.contact_count.toLocaleString()}
        </Badge>
      ),
    },
    {
      id: 'counted',
      header: 'Counted',
      align: 'right',
      sortable: true,
      sortValue: (s) => (s.last_counted_at ? new Date(s.last_counted_at).getTime() : 0),
      cell: (s) => (
        <span className="text-[12px] text-[var(--crm-text-tertiary)]">{relativeTime(s.last_counted_at)}</span>
      ),
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      cell: (s) => (
        <Link
          href={`/admin/crm/segments/${s.id}/edit`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-[12px] text-[var(--crm-text-tertiary)] hover:text-[var(--crm-text-primary)]"
          data-testid="crm-segment-edit"
        >
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Link>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6" data-testid="crm-segments">
      <PageHeader
        title="Segments"
        subtitle="Dynamic audiences for campaigns. Counts refresh whenever a rule changes."
        data-testid="crm-segments-header"
        actions={
          <Link href="/admin/crm/segments/new" data-testid="crm-segments-new">
            <Button variant="primary">
              <Plus className="h-4 w-4" /> New segment
            </Button>
          </Link>
        }
      />

      <DataTable
        data-testid="crm-segments-table"
        columns={columns}
        rows={rows}
        getRowId={(s) => s.id}
        onSelect={(s) => router.push(`/admin/crm/segments/${s.id}/edit`)}
        toolbar={
          <Toolbar data-testid="crm-segments-toolbar">
            <SearchField
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search segments…"
              data-testid="crm-segments-search"
            />
          </Toolbar>
        }
        error={
          loadError ? (
            <EmptyState
              icon={AlertTriangle}
              variant="error"
              title="Failed to load segments"
              description={loadError}
              data-testid="crm-segments-error"
            />
          ) : undefined
        }
        empty={
          <EmptyState
            icon={Filter}
            title={filterActive ? 'No segments match your search' : 'No segments yet'}
            description={
              filterActive
                ? 'Try a different search query.'
                : 'Segments power campaign targeting. Build one with rules like “lifecycle_stage equals deposit_paid” to bundle a recurring audience.'
            }
            data-testid="crm-segments-empty"
            action={
              !filterActive ? (
                <Link href="/admin/crm/segments/new" data-testid="crm-segments-empty-new">
                  <Button variant="primary">
                    <Plus className="h-4 w-4" /> New segment
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
