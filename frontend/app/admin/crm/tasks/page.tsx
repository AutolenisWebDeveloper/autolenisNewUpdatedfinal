'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckSquare, Plus, X, Zap } from 'lucide-react';
import type { CRMTask, TaskPriority } from '@/lib/types/crm';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  Tabs,
  type Column,
  type Tone,
} from '@/components/admin/crm/ui';

type TaskRow = CRMTask & {
  contact: { id: string; first_name: string | null; last_name: string | null; email: string | null } | null;
};

type Filter = 'all' | 'overdue' | 'urgent';

const PRIORITY_TONE: Record<TaskPriority, Tone> = {
  urgent: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
};

function formatDue(iso: string | null): string {
  if (!iso) return 'No due date';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/admin/crm/tasks?status=open,in_progress')
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setTasks((json.data as TaskRow[]) ?? []);
      })
      .catch(() => {
        if (!cancelled) setTasks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const now = Date.now();
  const counts = useMemo(() => {
    const overdue = tasks.filter((t) => t.due_at && new Date(t.due_at).getTime() < now).length;
    const urgent = tasks.filter((t) => t.priority === 'urgent').length;
    return { all: tasks.length, overdue, urgent };
  }, [tasks, now]);

  const filtered = useMemo(() => {
    if (filter === 'overdue') {
      return tasks.filter((t) => t.due_at && new Date(t.due_at).getTime() < now);
    }
    if (filter === 'urgent') {
      return tasks.filter((t) => t.priority === 'urgent');
    }
    return tasks;
  }, [tasks, filter, now]);

  async function completeTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/admin/crm/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    }).catch(() => setRefresh((r) => r + 1));
  }

  const columns: Column<TaskRow>[] = [
    {
      id: 'title',
      header: 'Task',
      sortable: true,
      sortValue: (t) => t.title.toLowerCase(),
      cell: (t) => {
        const contactName = t.contact
          ? [t.contact.first_name, t.contact.last_name].filter(Boolean).join(' ') || t.contact.email
          : null;
        return (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-[var(--crm-text-primary)]">{t.title}</span>
              {t.scope === 'system' && (
                <Badge tone="primary" size="sm" data-testid="crm-task-auto">
                  <Zap className="h-2.5 w-2.5" /> Auto
                </Badge>
              )}
            </div>
            {t.description && (
              <p className="mt-0.5 line-clamp-2 text-[12px] text-[var(--crm-text-tertiary)]">{t.description}</p>
            )}
            {contactName && t.contact && (
              <Link
                href={`/admin/crm/contacts/${t.contact.id}`}
                onClick={(e) => e.stopPropagation()}
                className="mt-1 inline-block text-[12px] text-[var(--crm-primary)] hover:text-[var(--crm-primary-hover)]"
                data-testid="crm-task-contact"
              >
                {contactName}
              </Link>
            )}
          </div>
        );
      },
    },
    {
      id: 'priority',
      header: 'Priority',
      sortable: true,
      sortValue: (t) => ({ urgent: 0, high: 1, medium: 2, low: 3 })[t.priority],
      cell: (t) => (
        <Badge tone={PRIORITY_TONE[t.priority]} size="sm" className="capitalize" data-testid="crm-task-priority">
          {t.priority}
        </Badge>
      ),
    },
    {
      id: 'due',
      header: 'Due',
      align: 'right',
      sortable: true,
      sortValue: (t) => (t.due_at ? new Date(t.due_at).getTime() : Number.POSITIVE_INFINITY),
      cell: (t) => {
        const overdue = !!t.due_at && new Date(t.due_at).getTime() < now;
        return (
          <span
            className={`text-[12px] tabular-nums ${overdue ? 'text-[var(--crm-danger)]' : 'text-[var(--crm-text-tertiary)]'}`}
            data-testid="crm-task-due"
          >
            {overdue && t.due_at ? 'Overdue · ' : ''}
            {formatDue(t.due_at)}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-5 p-6" data-testid="crm-tasks">
      <PageHeader
        title="Tasks"
        subtitle="Open work items across the platform — manual and system-generated."
        data-testid="crm-tasks-header"
        actions={
          <Button variant="primary" onClick={() => setShowAddModal(true)} data-testid="crm-tasks-add">
            <Plus className="h-4 w-4" /> Add task
          </Button>
        }
      />

      <Tabs
        data-testid="crm-tasks-tabs"
        value={filter}
        onValueChange={(id) => setFilter(id as Filter)}
        tabs={[
          { id: 'all', label: 'All', count: counts.all },
          { id: 'overdue', label: 'Overdue', count: counts.overdue },
          { id: 'urgent', label: 'Urgent', count: counts.urgent },
        ]}
      />

      <DataTable
        data-testid="crm-tasks-table"
        columns={columns}
        rows={filtered}
        getRowId={(t) => t.id}
        loading={loading}
        leadingHeader={null}
        leading={(t) => (
          <button
            onClick={() => completeTask(t.id)}
            aria-label="Complete task"
            data-testid="crm-task-complete"
            className="mt-0.5 h-4 w-4 rounded border border-[var(--crm-border-strong)] transition-colors hover:border-[var(--crm-success)] hover:bg-[var(--crm-success-subtle)]"
          />
        )}
        empty={
          <EmptyState
            icon={CheckSquare}
            title={
              filter === 'all'
                ? 'No open tasks'
                : filter === 'overdue'
                  ? 'No overdue tasks'
                  : 'No urgent tasks'
            }
            description={
              filter === 'all'
                ? 'Tasks created here or by automations will appear in this list.'
                : 'Keep up the good work — nothing pressing right now.'
            }
            data-testid="crm-tasks-empty"
          />
        }
      />

      {showAddModal && (
        <AddTaskModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => {
            setShowAddModal(false);
            setRefresh((r) => r + 1);
          }}
        />
      )}
    </div>
  );
}

function AddTaskModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueAt, setDueAt] = useState('');
  const [contactId, setContactId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/crm/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          priority,
          scope: contactId ? 'contact' : 'admin',
          contact_id: contactId.trim() || null,
          due_at: dueAt ? new Date(dueAt).toISOString() : null,
        }),
      });
      if (res.ok) {
        onCreated();
      } else {
        const json = await res.json().catch(() => ({ error: 'CREATE_FAILED' }));
        setError(json.error ?? 'Could not create task');
      }
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass =
    'w-full rounded-[var(--crm-radius-sm)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] px-3 py-2 text-[13px] text-[var(--crm-text-primary)] outline-none placeholder:text-[var(--crm-text-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)]';
  const labelClass = 'mb-1 block text-[12px] text-[var(--crm-text-tertiary)]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
      data-testid="crm-task-modal"
    >
      <div
        className="w-full max-w-md rounded-[var(--crm-radius-lg)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[16px] font-medium text-[var(--crm-text-primary)]">New task</h3>
          <button
            onClick={onClose}
            className="rounded-[var(--crm-radius-sm)] p-1 text-[var(--crm-text-tertiary)] hover:bg-[var(--crm-bg-tertiary)] hover:text-[var(--crm-text-primary)]"
            aria-label="Close"
            data-testid="crm-task-modal-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className={labelClass}>Title *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to happen?"
              className={fieldClass}
              data-testid="crm-task-modal-title"
            />
          </div>
          <div>
            <label className={labelClass}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className={`${fieldClass} resize-none`}
              data-testid="crm-task-modal-description"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className={fieldClass}
                data-testid="crm-task-modal-priority"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Due</label>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className={fieldClass}
                data-testid="crm-task-modal-due"
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Contact ID (optional)</label>
            <input
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              placeholder="UUID of contact, or leave blank for admin task"
              className={`${fieldClass} font-[family-name:var(--font-mono)] text-[12px]`}
              data-testid="crm-task-modal-contact"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-[12px] text-[var(--crm-danger)]">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} data-testid="crm-task-modal-cancel">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
            data-testid="crm-task-modal-submit"
          >
            {submitting ? 'Creating…' : 'Create task'}
          </Button>
        </div>
      </div>
    </div>
  );
}
