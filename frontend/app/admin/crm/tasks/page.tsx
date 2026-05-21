'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CheckSquare,
  Plus,
  Loader2,
  Zap,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CRMTask, TaskPriority } from '@/lib/types/crm';

type TaskRow = CRMTask & {
  contact: { id: string; first_name: string | null; last_name: string | null; email: string | null } | null;
};

type Filter = 'all' | 'overdue' | 'urgent';

const PRIORITY_DOT: Record<TaskPriority, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-gray-500',
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

  return (
    <div className="p-6 space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Tasks</h1>
          <p className="text-sm text-gray-500 mt-1">
            Open work items across the platform — manual and system-generated.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Task
        </button>
      </header>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        <FilterTab
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          label="All"
          count={counts.all}
        />
        <FilterTab
          active={filter === 'overdue'}
          onClick={() => setFilter('overdue')}
          label="Overdue"
          count={counts.overdue}
          accent="red"
        />
        <FilterTab
          active={filter === 'urgent'}
          onClick={() => setFilter('urgent')}
          label="Urgent"
          count={counts.urgent}
          accent="orange"
        />
      </div>

      {/* Task list */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-16 flex items-center justify-center">
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <CheckSquare className="w-12 h-12 text-gray-700 mx-auto mb-2" />
            <p className="text-sm text-gray-400 font-medium">
              {filter === 'all'
                ? 'No open tasks'
                : filter === 'overdue'
                  ? 'No overdue tasks'
                  : 'No urgent tasks'}
            </p>
            <p className="text-xs text-gray-600 mt-1">
              {filter === 'all'
                ? 'Tasks created here or by automations will appear in this list.'
                : 'Keep up the good work — nothing pressing right now.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-800/60">
            {filtered.map((task) => {
              const overdue = !!task.due_at && new Date(task.due_at).getTime() < now;
              const contactName = task.contact
                ? [task.contact.first_name, task.contact.last_name].filter(Boolean).join(' ') ||
                  task.contact.email
                : null;
              return (
                <li key={task.id} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-800/30">
                  <button
                    onClick={() => completeTask(task.id)}
                    aria-label="Complete task"
                    className="mt-0.5 w-4 h-4 rounded border border-gray-600 hover:border-emerald-500 hover:bg-emerald-500/10 transition-colors"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white">{task.title}</span>
                      {task.scope === 'system' && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-purple-500/15 text-purple-300 px-1.5 py-0.5 rounded-full">
                          <Zap className="w-2.5 h-2.5" /> Auto
                        </span>
                      )}
                    </div>
                    {task.description && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                        {task.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-[11px]">
                      {contactName && task.contact && (
                        <Link
                          href={`/admin/crm/contacts/${task.contact.id}`}
                          className="text-blue-400 hover:text-blue-300"
                        >
                          {contactName}
                        </Link>
                      )}
                      <span className={overdue ? 'text-red-400' : 'text-gray-600'}>
                        {overdue && task.due_at ? 'Overdue · ' : ''}
                        {formatDue(task.due_at)}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`w-2 h-2 rounded-full mt-2 shrink-0 ${PRIORITY_DOT[task.priority]}`}
                    aria-label={`Priority ${task.priority}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

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

function FilterTab({
  active,
  onClick,
  label,
  count,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  accent?: 'red' | 'orange';
}) {
  const accentText =
    accent === 'red' ? 'text-red-400' : accent === 'orange' ? 'text-orange-400' : 'text-gray-400';
  return (
    <button
      onClick={onClick}
      className={cn(
        '-mb-px px-3 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2',
        active
          ? 'border-blue-500 text-white'
          : 'border-transparent text-gray-500 hover:text-gray-300',
      )}
    >
      {label}
      <span
        className={cn(
          'text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-gray-800',
          active ? 'text-white' : accentText,
        )}
      >
        {count}
      </span>
    </button>
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

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-white">New Task</h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-500 hover:text-gray-300"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Title *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to happen?"
              className="w-full bg-gray-950 border border-gray-700 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full bg-gray-950 border border-gray-700 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-white resize-none transition-colors"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full bg-gray-950 border border-gray-700 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-white transition-colors"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Due</label>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="w-full bg-gray-950 border border-gray-700 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-white transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Contact ID (optional)</label>
            <input
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              placeholder="UUID of contact, or leave blank for admin task"
              className="w-full bg-gray-950 border border-gray-700 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-gray-700 transition-colors"
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
            className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creating…' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  );
}
