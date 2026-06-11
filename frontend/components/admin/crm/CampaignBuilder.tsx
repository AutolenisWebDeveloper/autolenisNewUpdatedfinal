'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Mail,
  MessageSquare,
  Layers,
  Users,
  FileText,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  Campaign,
  CampaignType,
  EmailTemplate,
  Segment,
} from '@/lib/types/crm';
import { Button } from './ui';

type Preview = {
  segment_size: number;
  will_receive: number;
  email_suppressed: number;
  sms_suppressed: number;
  do_not_contact: number;
  missing_email: number;
  missing_phone: number;
  missing_consent_email: number;
  missing_consent_sms: number;
};

const STEPS = [
  { id: 1, label: 'Type', icon: Layers },
  { id: 2, label: 'Audience', icon: Users },
  { id: 3, label: 'Content', icon: FileText },
  { id: 4, label: 'Schedule', icon: Calendar },
  { id: 5, label: 'Confirm', icon: CheckCircle2 },
];

export function CampaignBuilder() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [type, setType] = useState<CampaignType>('email');
  const [segmentId, setSegmentId] = useState<string>('');
  const [templateId, setTemplateId] = useState<string>('');
  const [smsBody, setSmsBody] = useState('');
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [segments, setSegments] = useState<Segment[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loadingDeps, setLoadingDeps] = useState(true);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewSeq = useRef(0);

  // Load segments + templates once. Both lists drive the selectors so we want
  // them ready by the time the user reaches step 2.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/admin/crm/segments').then((r) => r.json()),
      fetch('/api/admin/crm/templates?status=active').then((r) => r.json()),
    ])
      .then(([segRes, tplRes]) => {
        if (cancelled) return;
        setSegments((segRes.data as Segment[]) ?? []);
        setTemplates((tplRes.data as EmailTemplate[]) ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingDeps(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Recipient preview — refetch whenever segment or type changes.
  useEffect(() => {
    if (!segmentId) {
      setPreview(null);
      return;
    }
    const seq = ++previewSeq.current;
    setPreviewLoading(true);
    fetch('/api/admin/crm/campaigns/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, segment_id: segmentId }),
    })
      .then((r) => r.json())
      .then((json: { preview?: Preview }) => {
        if (seq !== previewSeq.current) return;
        if (json.preview) setPreview(json.preview);
      })
      .finally(() => {
        if (seq === previewSeq.current) setPreviewLoading(false);
      });
  }, [segmentId, type]);

  const smsSegments = useMemo(() => Math.ceil(smsBody.length / 160) || 1, [smsBody]);

  function canAdvance(): boolean {
    if (step === 1) return !!name.trim() && !!type;
    if (step === 2) return !!segmentId;
    if (step === 3) {
      if (type === 'email') return !!templateId;
      if (type === 'sms') return !!smsBody.trim();
      if (type === 'mixed') return !!templateId && !!smsBody.trim();
    }
    if (step === 4) {
      if (scheduleMode === 'later') {
        if (!scheduledAt) return false;
        return new Date(scheduledAt).getTime() > Date.now();
      }
      return true;
    }
    return true;
  }

  async function handleLaunch() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/admin/crm/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          type,
          segment_id: segmentId,
          template_id: type === 'sms' ? null : templateId,
          sms_body: type === 'email' ? null : smsBody,
          scheduled_at: scheduleMode === 'later' ? scheduledAt : null,
          send_immediately: scheduleMode === 'now',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'LAUNCH_FAILED' }));
        setError(err.error ?? 'LAUNCH_FAILED');
        return;
      }

      const json = (await res.json()) as { campaign: Campaign };
      router.push(`/admin/crm/campaigns/${json.campaign.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  const selectedSegment = segments.find((s) => s.id === segmentId) ?? null;
  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null;

  const inputClass =
    'mt-1 w-full rounded-[var(--crm-radius-sm)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] px-3 py-2 text-[13px] text-[var(--crm-text-primary)] placeholder:text-[var(--crm-text-tertiary)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)]';
  const labelClass =
    'text-[11px] font-medium uppercase tracking-wide text-[var(--crm-text-tertiary)]';

  return (
    <div className="mx-auto max-w-4xl p-6" data-testid="crm-campaign-builder">
      <header className="mb-6">
        <Link
          href="/admin/crm/campaigns"
          data-testid="crm-campaign-builder-back-link"
          className="mb-2 inline-flex items-center gap-1 text-[12px] text-[var(--crm-text-tertiary)] transition-colors hover:text-[var(--crm-text-primary)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Campaigns
        </Link>
        <h1 className="text-[22px] font-medium leading-7 text-[var(--crm-text-primary)]">New campaign</h1>
      </header>

      {/* Stepper */}
      <div className="mb-8 flex items-center justify-between" data-testid="crm-campaign-builder-stepper">
        {STEPS.map((s, idx) => {
          const Icon = s.icon;
          const active = step === s.id;
          const complete = step > s.id;
          return (
            <div key={s.id} className="flex flex-1 items-center">
              <div
                className={cn(
                  'flex items-center gap-2',
                  active && 'text-[var(--crm-text-primary)]',
                  complete && 'text-[var(--crm-success)]',
                  !active && !complete && 'text-[var(--crm-text-tertiary)]',
                )}
              >
                <div
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full border',
                    active && 'border-[var(--crm-primary)] bg-[var(--crm-primary-subtle)] text-[var(--crm-primary)]',
                    complete && 'border-[var(--crm-success)] bg-[var(--crm-success-subtle)]',
                    !active && !complete && 'border-[var(--crm-border-strong)]',
                  )}
                >
                  {complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                </div>
                <span className="text-[11px] font-medium uppercase tracking-wide">{s.label}</span>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className={cn(
                    'mx-3 h-px flex-1',
                    complete ? 'bg-[var(--crm-success)]' : 'bg-[var(--crm-border)]',
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div
          className="mb-4 flex items-start gap-2 rounded-[var(--crm-radius-sm)] border border-[var(--crm-danger-subtle)] bg-[var(--crm-danger-subtle)] px-4 py-2.5 text-[12px] text-[var(--crm-danger)]"
          data-testid="crm-campaign-builder-error"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      <div className="min-h-[280px] rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] p-6">
        {/* Step 1 — Type */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <label className={labelClass}>Campaign name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. October deposit reminders"
                className={inputClass}
                data-testid="crm-campaign-builder-name"
              />
            </div>
            <div>
              <div className={cn(labelClass, 'mb-2')}>Channel</div>
              <div className="grid grid-cols-3 gap-3">
                <TypeCard
                  active={type === 'email'}
                  onClick={() => setType('email')}
                  icon={Mail}
                  label="Email"
                  description="One template, recipient-personalized"
                  data-testid="crm-campaign-builder-type-email"
                />
                <TypeCard
                  active={type === 'sms'}
                  onClick={() => setType('sms')}
                  icon={MessageSquare}
                  label="SMS"
                  description="160-char body with STOP footer"
                  data-testid="crm-campaign-builder-type-sms"
                />
                <TypeCard
                  active={type === 'mixed'}
                  onClick={() => setType('mixed')}
                  icon={Layers}
                  label="Email + SMS"
                  description="Both channels, gated by consent"
                  data-testid="crm-campaign-builder-type-mixed"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 2 — Audience */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <label className={labelClass}>Segment</label>
              {loadingDeps ? (
                <div className="mt-1 flex items-center gap-2 text-[12px] text-[var(--crm-text-tertiary)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading segments…
                </div>
              ) : segments.length === 0 ? (
                <div className="mt-1 flex items-start gap-2 text-[12px] text-[var(--crm-warning)]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
                  No segments yet —{' '}
                  <Link href="/admin/crm/segments/new" className="text-[var(--crm-primary)] underline">
                    create one
                  </Link>{' '}
                  before launching a campaign.
                </div>
              ) : (
                <select
                  value={segmentId}
                  onChange={(e) => setSegmentId(e.target.value)}
                  className={inputClass}
                  data-testid="crm-campaign-builder-segment"
                >
                  <option value="">Select a segment…</option>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.contact_count.toLocaleString()})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedSegment && (
              <div
                className="rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-secondary)] p-4"
                data-testid="crm-campaign-builder-preview"
              >
                <div className={cn(labelClass, 'mb-2')}>Recipient preview</div>
                {previewLoading || !preview ? (
                  <div className="flex items-center gap-2 text-[12px] text-[var(--crm-text-tertiary)]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Computing…
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    <Stat label="Segment size" value={preview.segment_size} />
                    <Stat
                      label="Suppressed/excluded"
                      value={
                        preview.email_suppressed +
                        preview.sms_suppressed +
                        preview.do_not_contact
                      }
                      tone="warn"
                    />
                    <Stat label="Will receive" value={preview.will_receive} tone="good" big />
                  </div>
                )}
                {preview && (
                  <ul className="mt-3 space-y-0.5 text-[11px] text-[var(--crm-text-tertiary)]">
                    {preview.do_not_contact > 0 && (
                      <li>{preview.do_not_contact.toLocaleString()} flagged do-not-contact</li>
                    )}
                    {preview.missing_consent_email > 0 && (
                      <li>{preview.missing_consent_email.toLocaleString()} missing email consent</li>
                    )}
                    {preview.missing_consent_sms > 0 && (
                      <li>{preview.missing_consent_sms.toLocaleString()} missing SMS consent</li>
                    )}
                    {preview.missing_email > 0 && (
                      <li>{preview.missing_email.toLocaleString()} have no email on file</li>
                    )}
                    {preview.missing_phone > 0 && (
                      <li>{preview.missing_phone.toLocaleString()} have no phone on file</li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 3 — Content */}
        {step === 3 && (
          <div className="space-y-5">
            {(type === 'email' || type === 'mixed') && (
              <div>
                <label className={labelClass}>Email template</label>
                {loadingDeps ? (
                  <div className="mt-1 flex items-center gap-2 text-[12px] text-[var(--crm-text-tertiary)]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading templates…
                  </div>
                ) : templates.length === 0 ? (
                  <div className="mt-1 flex items-start gap-2 text-[12px] text-[var(--crm-warning)]">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
                    No active templates —{' '}
                    <Link href="/admin/crm/templates/new" className="text-[var(--crm-primary)] underline">
                      create one
                    </Link>
                    .
                  </div>
                ) : (
                  <>
                    <select
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value)}
                      className={inputClass}
                      data-testid="crm-campaign-builder-template"
                    >
                      <option value="">Select a template…</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.category})
                        </option>
                      ))}
                    </select>
                    {selectedTemplate && (
                      <div className="mt-2 text-[11px] text-[var(--crm-text-tertiary)]">
                        Subject: <span className="text-[var(--crm-text-secondary)]">{selectedTemplate.subject}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {(type === 'sms' || type === 'mixed') && (
              <div>
                <label className={labelClass}>SMS body</label>
                <textarea
                  value={smsBody}
                  onChange={(e) => setSmsBody(e.target.value)}
                  rows={4}
                  placeholder="Hey {{firstName}}, your deposit window closes in 24h…"
                  className={cn(inputClass, 'resize-y font-mono text-[12px]')}
                  data-testid="crm-campaign-builder-sms"
                />
                <div className="mt-1.5 flex items-center justify-between text-[10px] text-[var(--crm-text-tertiary)]">
                  <span>
                    {smsBody.length} chars · {smsSegments} segment{smsSegments > 1 ? 's' : ''}
                  </span>
                  <span className="text-[var(--crm-warning)]">
                    {`"Reply STOP to opt out."`} appended automatically.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 4 — Schedule */}
        {step === 4 && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <ScheduleCard
                active={scheduleMode === 'now'}
                onClick={() => setScheduleMode('now')}
                label="Send immediately"
                description="Fan-out enqueues as soon as you confirm."
                data-testid="crm-campaign-builder-schedule-now"
              />
              <ScheduleCard
                active={scheduleMode === 'later'}
                onClick={() => setScheduleMode('later')}
                label="Schedule for later"
                description="Hourly cron picks up due campaigns."
                data-testid="crm-campaign-builder-schedule-later"
              />
            </div>
            {scheduleMode === 'later' && (
              <div>
                <label className={labelClass}>Send at</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                  className={inputClass}
                  data-testid="crm-campaign-builder-scheduled-at"
                />
                <div className="mt-1 text-[10px] text-[var(--crm-text-tertiary)]">
                  Picked up within 5 minutes of this time by the scheduled-campaign cron.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 5 — Confirm */}
        {step === 5 && preview && (
          <div className="space-y-4" data-testid="crm-campaign-builder-confirm">
            <div className="flex items-start gap-2 rounded-[var(--crm-radius-sm)] border border-[var(--crm-danger-subtle)] bg-[var(--crm-danger-subtle)] px-4 py-3 text-[12px] text-[var(--crm-danger)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                You{`'`}re about to send this campaign to{' '}
                <strong>{preview.will_receive.toLocaleString()}</strong> real contacts. This
                cannot be undone.
              </div>
            </div>

            <dl className="divide-y divide-[var(--crm-border)] rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline text-[13px]">
              <Row k="Name" v={name} />
              <Row k="Type" v={type} />
              <Row k="Segment" v={selectedSegment?.name ?? '—'} />
              {(type === 'email' || type === 'mixed') && (
                <Row k="Template" v={selectedTemplate?.name ?? '—'} />
              )}
              {(type === 'sms' || type === 'mixed') && (
                <Row k="SMS body" v={`${smsBody.slice(0, 60)}${smsBody.length > 60 ? '…' : ''}`} />
              )}
              <Row
                k="Send time"
                v={scheduleMode === 'now' ? 'Immediately' : new Date(scheduledAt).toLocaleString()}
              />
              <Row k="Will receive" v={preview.will_receive.toLocaleString()} />
            </dl>
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between">
        <button
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1}
          data-testid="crm-campaign-builder-back"
          className="inline-flex items-center gap-1 text-[12px] text-[var(--crm-text-tertiary)] outline-none transition-colors hover:text-[var(--crm-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)] disabled:opacity-30"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Back
        </button>

        {step < 5 ? (
          <Button
            variant="primary"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canAdvance()}
            data-testid="crm-campaign-builder-continue"
          >
            Continue <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={handleLaunch}
            disabled={submitting || !preview || preview.will_receive === 0}
            data-testid="crm-campaign-builder-launch"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {scheduleMode === 'now' ? 'Launch campaign' : 'Schedule campaign'}
          </Button>
        )}
      </div>
    </div>
  );
}

function TypeCard({
  active,
  onClick,
  icon: Icon,
  label,
  description,
  'data-testid': testId,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Mail;
  label: string;
  description: string;
  'data-testid'?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      aria-pressed={active}
      className={cn(
        'rounded-[var(--crm-radius-md)] border p-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)]',
        active
          ? 'border-[var(--crm-primary)] bg-[var(--crm-primary-subtle)]'
          : 'border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] hover:border-[var(--crm-border-strong)]',
      )}
    >
      <Icon className={cn('mb-2 h-5 w-5', active ? 'text-[var(--crm-primary)]' : 'text-[var(--crm-text-tertiary)]')} />
      <div className="text-[13px] font-medium text-[var(--crm-text-primary)]">{label}</div>
      <div className="mt-1 text-[11px] leading-relaxed text-[var(--crm-text-tertiary)]">{description}</div>
    </button>
  );
}

function ScheduleCard({
  active,
  onClick,
  label,
  description,
  'data-testid': testId,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  description: string;
  'data-testid'?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      aria-pressed={active}
      className={cn(
        'rounded-[var(--crm-radius-md)] border p-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)]',
        active
          ? 'border-[var(--crm-primary)] bg-[var(--crm-primary-subtle)]'
          : 'border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] hover:border-[var(--crm-border-strong)]',
      )}
    >
      <div className="text-[13px] font-medium text-[var(--crm-text-primary)]">{label}</div>
      <div className="mt-1 text-[11px] leading-relaxed text-[var(--crm-text-tertiary)]">{description}</div>
    </button>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
  big = false,
}: {
  label: string;
  value: number;
  tone?: 'default' | 'warn' | 'good';
  big?: boolean;
}) {
  const toneClass =
    tone === 'good'
      ? 'text-[var(--crm-success)]'
      : tone === 'warn'
        ? 'text-[var(--crm-warning)]'
        : 'text-[var(--crm-text-primary)]';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--crm-text-tertiary)]">{label}</div>
      <div className={cn('font-medium tabular-nums', big ? 'text-[22px] leading-7' : 'text-[18px]', toneClass)}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="flex justify-between px-4 py-2.5">
      <span className="text-[11px] uppercase tracking-wide text-[var(--crm-text-tertiary)]">{k}</span>
      <span className="text-[13px] text-[var(--crm-text-primary)]">{String(v)}</span>
    </div>
  );
}
