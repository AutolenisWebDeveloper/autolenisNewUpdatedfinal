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

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <header className="mb-6">
        <Link
          href="/admin/crm/campaigns"
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors mb-2"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Campaigns
        </Link>
        <h1 className="text-xl font-bold text-white">New campaign</h1>
      </header>

      {/* Stepper */}
      <div className="flex items-center justify-between mb-8">
        {STEPS.map((s, idx) => {
          const Icon = s.icon;
          const active = step === s.id;
          const complete = step > s.id;
          return (
            <div key={s.id} className="flex items-center flex-1">
              <div
                className={cn(
                  'flex items-center gap-2',
                  active && 'text-white',
                  complete && 'text-emerald-400',
                  !active && !complete && 'text-gray-600',
                )}
              >
                <div
                  className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center border-2',
                    active && 'border-blue-500 bg-blue-500/10',
                    complete && 'border-emerald-500 bg-emerald-500/10',
                    !active && !complete && 'border-gray-700',
                  )}
                >
                  {complete ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-wider">
                  {s.label}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className={cn(
                    'flex-1 h-px mx-3',
                    complete ? 'bg-emerald-500/50' : 'bg-gray-800',
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5 text-xs text-red-300 mb-4 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 min-h-[280px]">
        {/* Step 1 — Type */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Campaign name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. October deposit reminders"
                className="mt-1 w-full bg-gray-950 border border-gray-800 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 transition-colors"
              />
            </div>
            <div>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Channel
              </div>
              <div className="grid grid-cols-3 gap-3">
                <TypeCard
                  active={type === 'email'}
                  onClick={() => setType('email')}
                  icon={Mail}
                  label="Email"
                  description="One template, recipient-personalized"
                />
                <TypeCard
                  active={type === 'sms'}
                  onClick={() => setType('sms')}
                  icon={MessageSquare}
                  label="SMS"
                  description="160-char body with STOP footer"
                />
                <TypeCard
                  active={type === 'mixed'}
                  onClick={() => setType('mixed')}
                  icon={Layers}
                  label="Email + SMS"
                  description="Both channels, gated by consent"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 2 — Audience */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Segment
              </label>
              {loadingDeps ? (
                <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading segments…
                </div>
              ) : segments.length === 0 ? (
                <div className="mt-1 text-xs text-yellow-400 flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5" />
                  No segments yet —{' '}
                  <Link href="/admin/crm/segments/new" className="text-blue-400 underline">
                    create one
                  </Link>{' '}
                  before launching a campaign.
                </div>
              ) : (
                <select
                  value={segmentId}
                  onChange={(e) => setSegmentId(e.target.value)}
                  className="mt-1 w-full bg-gray-950 border border-gray-800 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-white transition-colors"
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
              <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Recipient preview
                </div>
                {previewLoading || !preview ? (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Computing…
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
                  <ul className="mt-3 space-y-0.5 text-[11px] text-gray-500">
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
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Email template
                </label>
                {loadingDeps ? (
                  <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading templates…
                  </div>
                ) : templates.length === 0 ? (
                  <div className="mt-1 text-xs text-yellow-400 flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5" />
                    No active templates —{' '}
                    <Link href="/admin/crm/templates/new" className="text-blue-400 underline">
                      create one
                    </Link>
                    .
                  </div>
                ) : (
                  <>
                    <select
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value)}
                      className="mt-1 w-full bg-gray-950 border border-gray-800 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-white transition-colors"
                    >
                      <option value="">Select a template…</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.category})
                        </option>
                      ))}
                    </select>
                    {selectedTemplate && (
                      <div className="mt-2 text-[11px] text-gray-500">
                        Subject: <span className="text-gray-300">{selectedTemplate.subject}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {(type === 'sms' || type === 'mixed') && (
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  SMS body
                </label>
                <textarea
                  value={smsBody}
                  onChange={(e) => setSmsBody(e.target.value)}
                  rows={4}
                  placeholder="Hey {{firstName}}, your deposit window closes in 24h…"
                  className="mt-1 w-full bg-gray-950 border border-gray-800 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-gray-600 resize-y transition-colors"
                />
                <div className="flex items-center justify-between mt-1.5 text-[10px] text-gray-600">
                  <span>
                    {smsBody.length} chars · {smsSegments} segment{smsSegments > 1 ? 's' : ''}
                  </span>
                  <span className="text-yellow-500">
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
              />
              <ScheduleCard
                active={scheduleMode === 'later'}
                onClick={() => setScheduleMode('later')}
                label="Schedule for later"
                description="Hourly cron picks up due campaigns."
              />
            </div>
            {scheduleMode === 'later' && (
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Send at
                </label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                  className="mt-1 w-full bg-gray-950 border border-gray-800 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-white transition-colors"
                />
                <div className="text-[10px] text-gray-600 mt-1">
                  Picked up within 5 minutes of this time by the scheduled-campaign cron.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 5 — Confirm */}
        {step === 5 && preview && (
          <div className="space-y-4">
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-xs text-red-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                You{`'`}re about to send this campaign to{' '}
                <strong>{preview.will_receive.toLocaleString()}</strong> real contacts. This
                cannot be undone.
              </div>
            </div>

            <dl className="bg-gray-950 border border-gray-800 rounded-xl divide-y divide-gray-800 text-sm">
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

      <div className="flex items-center justify-between mt-5">
        <button
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors disabled:opacity-30"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Back
        </button>

        {step < 5 ? (
          <button
            onClick={() => setStep((s) => s + 1)}
            disabled={!canAdvance()}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Continue <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handleLaunch}
            disabled={submitting || !preview || preview.will_receive === 0}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {scheduleMode === 'now' ? 'Launch campaign' : 'Schedule campaign'}
          </button>
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
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Mail;
  label: string;
  description: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'text-left rounded-xl border-2 p-4 transition-colors',
        active
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-gray-800 bg-gray-950 hover:border-gray-700',
      )}
    >
      <Icon className={cn('w-5 h-5 mb-2', active ? 'text-blue-400' : 'text-gray-500')} />
      <div className="text-sm font-semibold text-white">{label}</div>
      <div className="text-[11px] text-gray-500 mt-1 leading-relaxed">{description}</div>
    </button>
  );
}

function ScheduleCard({
  active,
  onClick,
  label,
  description,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  description: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'text-left rounded-xl border-2 p-4 transition-colors',
        active
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-gray-800 bg-gray-950 hover:border-gray-700',
      )}
    >
      <div className="text-sm font-semibold text-white">{label}</div>
      <div className="text-[11px] text-gray-500 mt-1 leading-relaxed">{description}</div>
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
    tone === 'good' ? 'text-emerald-400' : tone === 'warn' ? 'text-yellow-400' : 'text-white';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-600">{label}</div>
      <div className={cn('font-bold tabular-nums', big ? 'text-2xl' : 'text-lg', toneClass)}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="flex justify-between px-4 py-2.5">
      <span className="text-[11px] uppercase tracking-wider text-gray-500">{k}</span>
      <span className="text-sm text-white">{String(v)}</span>
    </div>
  );
}
