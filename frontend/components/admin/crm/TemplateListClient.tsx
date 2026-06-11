'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, Plus, Pencil, Tag, AlertTriangle } from 'lucide-react';
import type { EmailTemplate, EmailTemplateStatus } from '@/lib/types/crm';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  Toolbar,
  SearchField,
  SelectField,
  type Column,
  type Tone,
} from './ui';

const STATUS_TONE: Record<EmailTemplateStatus, Tone> = {
  active: 'success',
  draft: 'warning',
  inactive: 'neutral',
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

export function TemplateListClient({
  templates,
  loadError,
}: {
  templates: EmailTemplate[];
  loadError: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<EmailTemplateStatus | ''>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false;
      if (categoryFilter && t.category !== categoryFilter) return false;
      if (q && !`${t.name} ${t.subject}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [templates, query, statusFilter, categoryFilter]);

  const filterActive = !!query.trim() || !!statusFilter || !!categoryFilter;

  const columns: Column<EmailTemplate>[] = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      sortValue: (t) => t.name.toLowerCase(),
      cell: (t) => (
        <div className="min-w-0">
          <Link
            href={`/admin/crm/templates/${t.id}/edit`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-[var(--crm-text-primary)] hover:text-[var(--crm-primary)]"
            data-testid="crm-template-name"
          >
            {t.name}
          </Link>
          <div className="mt-0.5 max-w-md truncate text-[12px] text-[var(--crm-text-tertiary)]">
            {t.subject}
          </div>
        </div>
      ),
    },
    {
      id: 'category',
      header: 'Category',
      sortable: true,
      sortValue: (t) => t.category,
      cell: (t) => (
        <span className="inline-flex items-center gap-1 text-[12px] text-[var(--crm-text-tertiary)]">
          <Tag className="h-3 w-3" />
          {CATEGORY_LABEL[t.category] ?? t.category}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (t) => t.status,
      cell: (t) => (
        <Badge tone={STATUS_TONE[t.status]} size="sm" className="capitalize" data-testid="crm-template-status">
          {t.status}
        </Badge>
      ),
    },
    {
      id: 'version',
      header: 'Version',
      sortable: true,
      sortValue: (t) => t.version,
      cell: (t) => <span className="tabular-nums text-[var(--crm-text-tertiary)]">v{t.version}</span>,
    },
    {
      id: 'updated',
      header: 'Updated',
      align: 'right',
      sortable: true,
      sortValue: (t) => new Date(t.updated_at).getTime(),
      cell: (t) => <span className="text-[12px] text-[var(--crm-text-tertiary)]">{relativeTime(t.updated_at)}</span>,
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      cell: (t) => (
        <Link
          href={`/admin/crm/templates/${t.id}/edit`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-[12px] text-[var(--crm-text-tertiary)] hover:text-[var(--crm-text-primary)]"
          data-testid="crm-template-edit"
        >
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Link>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6" data-testid="crm-templates">
      <PageHeader
        title="Email templates"
        subtitle="Versioned, variable-substituted templates with CAN-SPAM footer enforcement."
        data-testid="crm-templates-header"
        actions={
          <Link href="/admin/crm/templates/new" data-testid="crm-templates-new">
            <Button variant="primary">
              <Plus className="h-4 w-4" /> New template
            </Button>
          </Link>
        }
      />

      <DataTable
        data-testid="crm-templates-table"
        columns={columns}
        rows={rows}
        getRowId={(t) => t.id}
        onSelect={(t) => router.push(`/admin/crm/templates/${t.id}/edit`)}
        toolbar={
          <Toolbar data-testid="crm-templates-toolbar">
            <SearchField
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or subject…"
              data-testid="crm-templates-search"
            />
            <SelectField
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              data-testid="crm-templates-category-filter"
            >
              <option value="">All categories</option>
              <option value="transactional">Transactional</option>
              <option value="marketing">Marketing</option>
              <option value="automation">Automation</option>
            </SelectField>
            <SelectField
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as EmailTemplateStatus | '')}
              data-testid="crm-templates-status-filter"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="inactive">Inactive</option>
            </SelectField>
          </Toolbar>
        }
        error={
          loadError ? (
            <EmptyState
              icon={AlertTriangle}
              variant="error"
              title="Failed to load templates"
              description={loadError}
              data-testid="crm-templates-error"
            />
          ) : undefined
        }
        empty={
          <EmptyState
            icon={FileText}
            title={filterActive ? 'No templates match your filters' : 'No templates yet'}
            description={
              filterActive
                ? 'Try adjusting your search or filters.'
                : 'Templates power transactional emails, marketing campaigns, and automation workflows. Create your first to get started.'
            }
            data-testid="crm-templates-empty"
            action={
              !filterActive ? (
                <Link href="/admin/crm/templates/new" data-testid="crm-templates-empty-new">
                  <Button variant="primary">
                    <Plus className="h-4 w-4" /> New template
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
