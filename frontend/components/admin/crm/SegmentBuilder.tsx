'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Save,
  Loader2,
  AlertTriangle,
  Plus,
  Trash2,
  ChevronLeft,
  CheckCircle2,
  Users,
} from 'lucide-react';
import { useDebounce } from '@/lib/hooks/use-debounce';
import { cn } from '@/lib/utils';
import type {
  Segment,
  SegmentConditions,
  SegmentField,
  SegmentOperator,
  SegmentRule,
} from '@/lib/types/crm';

type FieldOption = {
  field: SegmentField;
  label: string;
  type: 'text' | 'boolean' | 'timestamp' | 'enum' | 'number';
  operators: { value: SegmentOperator; label: string }[];
  options?: { value: string; label: string }[];
};

const LIFECYCLE_OPTIONS = [
  'lead', 'prequal_started', 'prequal_completed',
  'deposit_pending', 'deposit_paid', 'auction_active',
  'offer_received', 'purchase_completed', 'inactive',
].map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));

const SOURCE_OPTIONS = [
  'buyer_signup', 'dealer_signup', 'affiliate_signup',
  'public_form', 'sms_inbound', 'import',
].map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));

const FIELDS: FieldOption[] = [
  {
    field: 'lifecycle_stage',
    label: 'Lifecycle stage',
    type: 'enum',
    operators: [
      { value: 'eq', label: 'is' },
      { value: 'neq', label: 'is not' },
    ],
    options: LIFECYCLE_OPTIONS,
  },
  {
    field: 'consent_sms',
    label: 'SMS consent',
    type: 'boolean',
    operators: [
      { value: 'is_true', label: 'is granted' },
      { value: 'is_false', label: 'is not granted' },
    ],
  },
  {
    field: 'consent_email',
    label: 'Email consent',
    type: 'boolean',
    operators: [
      { value: 'is_true', label: 'is granted' },
      { value: 'is_false', label: 'is not granted' },
    ],
  },
  {
    field: 'do_not_contact',
    label: 'Do-not-contact flag',
    type: 'boolean',
    operators: [
      { value: 'is_true', label: 'is set' },
      { value: 'is_false', label: 'is not set' },
    ],
  },
  {
    field: 'source',
    label: 'Source',
    type: 'enum',
    operators: [
      { value: 'eq', label: 'is' },
      { value: 'neq', label: 'is not' },
    ],
    options: SOURCE_OPTIONS,
  },
  {
    field: 'utm_source',
    label: 'UTM source',
    type: 'text',
    operators: [
      { value: 'eq', label: 'equals' },
      { value: 'neq', label: 'does not equal' },
      { value: 'contains', label: 'contains' },
      { value: 'not_contains', label: 'does not contain' },
    ],
  },
  {
    field: 'utm_campaign',
    label: 'UTM campaign',
    type: 'text',
    operators: [
      { value: 'eq', label: 'equals' },
      { value: 'neq', label: 'does not equal' },
      { value: 'contains', label: 'contains' },
      { value: 'not_contains', label: 'does not contain' },
    ],
  },
  {
    field: 'created_at',
    label: 'Created at',
    type: 'timestamp',
    operators: [
      { value: 'after', label: 'is after' },
      { value: 'before', label: 'is before' },
    ],
  },
  {
    field: 'lead_temperature',
    label: 'Lead temperature',
    type: 'enum',
    operators: [
      { value: 'eq', label: 'is' },
      { value: 'neq', label: 'is not' },
    ],
    options: [
      { value: 'hot', label: 'hot' },
      { value: 'warm', label: 'warm' },
      { value: 'cold', label: 'cold' },
    ],
  },
  {
    field: 'lead_score',
    label: 'Lead score',
    type: 'number',
    operators: [
      { value: 'gte', label: 'is at least' },
      { value: 'lte', label: 'is at most' },
      { value: 'eq', label: 'equals' },
      { value: 'neq', label: 'does not equal' },
    ],
  },
  {
    field: 'tags',
    label: 'Interest tag',
    type: 'text',
    operators: [
      { value: 'has_tag', label: 'has tag' },
      { value: 'not_has_tag', label: 'does not have tag' },
    ],
  },
];

const FIELD_BY_NAME: Record<SegmentField, FieldOption> = Object.fromEntries(
  FIELDS.map((f) => [f.field, f]),
) as Record<SegmentField, FieldOption>;

type Props =
  | { mode: 'create' }
  | { mode: 'edit'; segment: Segment };

function defaultRule(): SegmentRule {
  return { field: 'lifecycle_stage', op: 'eq', value: 'lead' };
}

function defaultConditions(): SegmentConditions {
  return { match: 'all', rules: [defaultRule()] };
}

export function SegmentBuilder(props: Props) {
  const router = useRouter();
  const initial = useMemo(() => {
    if (props.mode === 'edit') {
      return {
        name: props.segment.name,
        description: props.segment.description ?? '',
        conditions:
          props.segment.conditions.rules.length > 0
            ? props.segment.conditions
            : defaultConditions(),
      };
    }
    return {
      name: '',
      description: '',
      conditions: defaultConditions(),
    };
  }, [props]);

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [conditions, setConditions] = useState<SegmentConditions>(initial.conditions);
  const [count, setCount] = useState<number | null>(
    props.mode === 'edit' ? props.segment.contact_count : null,
  );
  const [countLoading, setCountLoading] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const debouncedConditions = useDebounce(conditions, 500);

  useEffect(() => {
    const seqId = ++seq.current;
    setCountLoading(true);
    setCountError(null);
    fetch('/api/admin/crm/segments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditions: debouncedConditions }),
    })
      .then((r) => r.json())
      .then((json: { count?: number; error?: string }) => {
        if (seqId !== seq.current) return;
        if (typeof json.count === 'number') setCount(json.count);
        else setCountError(json.error ?? 'PREVIEW_FAILED');
      })
      .catch(() => {
        if (seqId === seq.current) setCountError('NETWORK_ERROR');
      })
      .finally(() => {
        if (seqId === seq.current) setCountLoading(false);
      });
  }, [debouncedConditions]);

  function updateRule(idx: number, patch: Partial<SegmentRule>) {
    setConditions((prev) => {
      const rules = prev.rules.slice();
      const current = rules[idx];
      const next = { ...current, ...patch };

      // Field changed → reset op + value to defaults compatible with the
      // new field, otherwise the rule will be rejected by normalizeConditions.
      if (patch.field && patch.field !== current.field) {
        const def = FIELD_BY_NAME[patch.field as SegmentField];
        next.op = def.operators[0].value;
        next.value = def.type === 'boolean' ? null : def.options?.[0]?.value ?? '';
      }

      // Operator changed to a boolean op → clear value.
      const def = FIELD_BY_NAME[next.field];
      if (def.type === 'boolean') next.value = null;

      rules[idx] = next;
      return { ...prev, rules };
    });
  }

  function addRule() {
    setConditions((prev) => ({ ...prev, rules: [...prev.rules, defaultRule()] }));
  }

  function removeRule(idx: number) {
    setConditions((prev) => ({
      ...prev,
      rules: prev.rules.filter((_, i) => i !== idx),
    }));
  }

  async function handleSave() {
    if (saving) return;
    setError(null);

    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (conditions.rules.length === 0) {
      setError('Add at least one rule.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        conditions,
      };
      const url =
        props.mode === 'create'
          ? '/api/admin/crm/segments'
          : `/api/admin/crm/segments/${props.segment.id}`;
      const method = props.mode === 'create' ? 'POST' : 'PATCH';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'SAVE_FAILED' }));
        setError(err.error ?? 'SAVE_FAILED');
        return;
      }

      const json = (await res.json()) as { segment: Segment };
      setSavedAt(Date.now());

      if (props.mode === 'create') {
        router.push(`/admin/crm/segments/${json.segment.id}/edit`);
      } else {
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/crm/segments"
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Segments
          </Link>
          <span className="text-gray-400">/</span>
          <h1 className="text-base font-bold text-gray-900">
            {props.mode === 'create' ? 'New segment' : props.segment.name}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {savedAt && (
            <span className="flex items-center gap-1 text-[11px] text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5" /> Saved
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-gray-900 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {props.mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-xs text-red-700 mb-4 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Marketing-opted leads"
                className="mt-1 w-full bg-white border border-gray-200 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Description (optional)
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this audience represent?"
                className="mt-1 w-full bg-white border border-gray-200 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors"
              />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Rules
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500">Match</span>
                <div className="flex bg-white border border-gray-200 rounded-md p-0.5 text-[10px] font-medium">
                  <button
                    onClick={() => setConditions((prev) => ({ ...prev, match: 'all' }))}
                    className={cn(
                      'px-2.5 py-1 rounded',
                      conditions.match === 'all' ? 'bg-blue-600 text-gray-900' : 'text-gray-500',
                    )}
                  >
                    ALL
                  </button>
                  <button
                    onClick={() => setConditions((prev) => ({ ...prev, match: 'any' }))}
                    className={cn(
                      'px-2.5 py-1 rounded',
                      conditions.match === 'any' ? 'bg-blue-600 text-gray-900' : 'text-gray-500',
                    )}
                  >
                    ANY
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {conditions.rules.map((rule, idx) => {
                const def = FIELD_BY_NAME[rule.field];
                return (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-center bg-white border border-gray-200 rounded-lg p-2.5"
                  >
                    <select
                      value={rule.field}
                      onChange={(e) =>
                        updateRule(idx, { field: e.target.value as SegmentField })
                      }
                      className="col-span-4 bg-white border border-gray-200 focus:border-blue-500 outline-none rounded px-2 py-1.5 text-xs text-gray-900 transition-colors"
                    >
                      {FIELDS.map((f) => (
                        <option key={f.field} value={f.field}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={rule.op}
                      onChange={(e) =>
                        updateRule(idx, { op: e.target.value as SegmentOperator })
                      }
                      className="col-span-3 bg-white border border-gray-200 focus:border-blue-500 outline-none rounded px-2 py-1.5 text-xs text-gray-900 transition-colors"
                    >
                      {def.operators.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {def.type === 'boolean' ? (
                      <div className="col-span-4 text-[11px] text-gray-500 italic px-2">
                        (no value needed)
                      </div>
                    ) : def.type === 'enum' ? (
                      <select
                        value={(rule.value as string) ?? ''}
                        onChange={(e) => updateRule(idx, { value: e.target.value })}
                        className="col-span-4 bg-white border border-gray-200 focus:border-blue-500 outline-none rounded px-2 py-1.5 text-xs text-gray-900 transition-colors"
                      >
                        {def.options!.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : def.type === 'timestamp' ? (
                      <input
                        type="date"
                        value={(rule.value as string) ?? ''}
                        onChange={(e) => updateRule(idx, { value: e.target.value })}
                        className="col-span-4 bg-white border border-gray-200 focus:border-blue-500 outline-none rounded px-2 py-1.5 text-xs text-gray-900 transition-colors"
                      />
                    ) : def.type === 'number' ? (
                      <input
                        type="number"
                        value={(rule.value as number | string) ?? ''}
                        onChange={(e) => updateRule(idx, { value: e.target.value })}
                        placeholder="score"
                        className="col-span-4 bg-white border border-gray-200 focus:border-blue-500 outline-none rounded px-2 py-1.5 text-xs text-gray-900 placeholder-gray-400 transition-colors"
                      />
                    ) : (
                      <input
                        value={(rule.value as string) ?? ''}
                        onChange={(e) => updateRule(idx, { value: e.target.value })}
                        placeholder="value"
                        className="col-span-4 bg-white border border-gray-200 focus:border-blue-500 outline-none rounded px-2 py-1.5 text-xs text-gray-900 placeholder-gray-400 transition-colors"
                      />
                    )}
                    <button
                      onClick={() => removeRule(idx)}
                      className="col-span-1 flex items-center justify-center text-gray-500 hover:text-red-600 transition-colors"
                      aria-label="Remove rule"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              onClick={addRule}
              className="mt-3 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add rule
            </button>
          </div>
        </div>

        <div>
          <div className="bg-white border border-gray-200 rounded-xl p-5 sticky top-6">
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Live preview
            </div>
            <div className="flex items-baseline gap-2">
              <div className="text-3xl font-bold text-gray-900 tabular-nums">
                {countLoading ? (
                  <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                ) : count !== null ? (
                  count.toLocaleString()
                ) : (
                  '—'
                )}
              </div>
              <div className="text-xs text-gray-500 flex items-center gap-1">
                <Users className="w-3 h-3" /> contacts
              </div>
            </div>
            {countError && (
              <div className="mt-2 text-[11px] text-red-600 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5" /> {countError}
              </div>
            )}
            <div className="mt-4 text-[11px] text-gray-500 leading-relaxed">
              Live count is computed against the contacts table (excluding
              soft-deleted rows). Campaign fan-out re-runs the same query at send
              time — a stale count never causes a stale send list.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
