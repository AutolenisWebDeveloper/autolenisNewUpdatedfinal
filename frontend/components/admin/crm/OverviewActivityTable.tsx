'use client';

import { useRouter } from 'next/navigation';
import { Activity } from 'lucide-react';
import type { TimelineEventType } from '@/lib/types/crm';
import { timelineVisual } from './TimelineIcon';
import { DataTable, EmptyState, type Column } from './ui';

export type ActivityRow = {
  id: string;
  contactId: string | null;
  eventType: TimelineEventType;
  name: string;
  createdAt: string;
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

/** Client wrapper so the RSC Overview page can consume the DataTable primitive. */
export function OverviewActivityTable({ rows }: { rows: ActivityRow[] }) {
  const router = useRouter();

  const columns: Column<ActivityRow>[] = [
    {
      id: 'event',
      header: 'Activity',
      cell: (row) => {
        const v = timelineVisual(row.eventType);
        const Icon = v.icon;
        return (
          <span className="flex items-center gap-2 text-[var(--crm-text-primary)]">
            <Icon className={`h-4 w-4 ${v.color}`} strokeWidth={1.75} />
            {v.label}
          </span>
        );
      },
    },
    {
      id: 'contact',
      header: 'Contact',
      cell: (row) => <span className="text-[var(--crm-text-secondary)]">{row.name}</span>,
    },
    {
      id: 'time',
      header: 'When',
      align: 'right',
      sortable: true,
      sortValue: (row) => new Date(row.createdAt).getTime(),
      cell: (row) => (
        <span className="tabular-nums text-[var(--crm-text-tertiary)]">
          {relativeTime(row.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      data-testid="crm-overview-activity-table"
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      showDensityToggle={false}
      onSelect={(r) => r.contactId && router.push(`/admin/crm/contacts/${r.contactId}`)}
      empty={
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="Timeline events appear here as contacts move through the funnel."
          data-testid="crm-overview-activity-empty"
        />
      }
    />
  );
}
