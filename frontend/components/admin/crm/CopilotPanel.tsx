'use client';

import { useState } from 'react';
import { Sparkles, Loader2, Check } from 'lucide-react';
import { SlideOver } from './ui/SlideOver';
import { Button } from './ui/Button';

// ── Mirror of the copilot route's response shapes ───────────────────────────
type ClaimFlag = {
  kind: 'currency' | 'percentage' | 'rating' | 'count' | 'ranking' | 'multiplier';
  match: string;
};
type EmailDraft = { subject: string; body: string; flags: ClaimFlag[] };
type SmsDraft = { body: string; flags: ClaimFlag[] };
type ContentDraft = { emails: EmailDraft[]; sms: SmsDraft[]; brief: string };
type AutomationStep = { channel: 'email' | 'sms'; delayHours: number; templateKey: string };
type AutomationPlan = { triggerEvent: string; audience: string; steps: AutomationStep[] };

type Mode = 'content' | 'automation_plan';
const SMS_MAX_CHARS = 160;

function SavedTag() {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-[var(--crm-success)]">
      <Check className="h-3.5 w-3.5" /> Saved as draft
    </span>
  );
}

// Non-blocking warning: lists the unsubstantiated-claim spans the human must
// verify, plus a required acknowledgment that gates Approve (never generation,
// never the copy itself).
function FlagWarning({
  flags,
  checked,
  onToggle,
}: {
  flags: ClaimFlag[];
  checked: boolean;
  onToggle: (v: boolean) => void;
}) {
  if (flags.length === 0) return null;
  return (
    <div
      data-testid="copilot-flags"
      className="mt-2 rounded-[var(--crm-radius-sm)] border border-[var(--crm-warning)] bg-[var(--crm-warning-subtle)] px-2.5 py-2 text-[12px] text-[var(--crm-warning)]"
    >
      <div className="font-medium">⚠ Unsubstantiated claim(s) — verify before use:</div>
      <ul className="mt-1 list-disc pl-4">
        {flags.map((f, i) => (
          <li key={`${f.kind}:${i}`} data-testid="copilot-flag">
            <span className="font-mono">{f.match}</span>{' '}
            <span className="text-[var(--crm-text-tertiary)]">({f.kind})</span>
          </li>
        ))}
      </ul>
      <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[var(--crm-text-secondary)]">
        <input
          type="checkbox"
          data-testid="copilot-flags-ack"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
        />
        I have verified these claims.
      </label>
    </div>
  );
}

export function CopilotPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<Mode>('content');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<ContentDraft | null>(null);
  const [plan, setPlan] = useState<AutomationPlan | null>(null);
  // Tracks which drafts have been approved, keyed by `${kind}:${index}`.
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  // Tracks the "I have verified these claims" acknowledgment per flagged draft.
  const [acked, setAcked] = useState<Record<string, boolean>>({});

  function reset() {
    setContent(null);
    setPlan(null);
    setSaved({});
    setAcked({});
    setError(null);
  }

  async function generate() {
    setLoading(true);
    reset();
    try {
      const res = await fetch('/api/admin/crm/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mode }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(
          json.issues?.length
            ? `Validation failed: ${json.issues.join('; ')}`
            : (json.error ?? 'Generation failed'),
        );
        return;
      }
      if (json.mode === 'content') setContent(json.draft as ContentDraft);
      else setPlan(json.plan as AutomationPlan);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  async function approve(
    key: string,
    payload:
      | { kind: 'email_template'; subject: string; body: string; flags: ClaimFlag[] }
      | { kind: 'sms_campaign'; body: string; flags: ClaimFlag[] },
  ) {
    setSavingKey(key);
    try {
      const res = await fetch('/api/admin/crm/copilot/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Echo the flags and the reviewer's acknowledgment so the server can
        // enforce the FTC sign-off and record it in the approval audit row.
        body: JSON.stringify({ ...payload, flagsAcknowledged: acked[key] === true }),
      });
      if (res.ok) setSaved((s) => ({ ...s, [key]: true }));
      else {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? 'Save failed');
      }
    } catch {
      setError('Network error saving draft');
    } finally {
      setSavingKey(null);
    }
  }

  const labelCls = 'text-[11px] font-medium uppercase tracking-wider text-[var(--crm-text-tertiary)]';
  const cardCls =
    'rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] p-3';

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      width="lg"
      data-testid="crm-copilot-panel"
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--crm-primary)]" /> AI Copilot
        </span>
      }
      subtitle="Drafts only — nothing sends until you approve and a human ships it."
    >
      <div className="flex flex-col gap-4 p-4">
        {/* Mode toggle */}
        <div className="flex gap-1 rounded-[var(--crm-radius-md)] bg-[var(--crm-bg-tertiary)] p-1" data-testid="crm-copilot-mode">
          {(['content', 'automation_plan'] as Mode[]).map((m) => (
            <button
              key={m}
              data-testid={`crm-copilot-mode-${m}`}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-[var(--crm-radius-sm)] px-3 py-1.5 text-[13px] font-medium transition-colors ${
                mode === m
                  ? 'bg-[var(--crm-bg-primary)] text-[var(--crm-text-primary)] shadow-sm'
                  : 'text-[var(--crm-text-tertiary)] hover:text-[var(--crm-text-secondary)]'
              }`}
            >
              {m === 'content' ? 'Marketing content' : 'Automation plan'}
            </button>
          ))}
        </div>

        {/* Prompt */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="copilot-prompt" className={labelCls}>
            Prompt
          </label>
          <textarea
            id="copilot-prompt"
            data-testid="crm-copilot-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder={
              mode === 'content'
                ? 'e.g. A 3-email re-engagement sequence for buyers who stalled after submitting a request.'
                : 'e.g. After deposit_paid, nurture the buyer toward selecting an offer over 5 days.'
            }
            className="w-full resize-none rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] px-3 py-2 text-[13px] text-[var(--crm-text-primary)] outline-none placeholder:text-[var(--crm-text-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)]"
          />
          <Button
            variant="primary"
            onClick={generate}
            disabled={loading || prompt.trim().length < 4}
            data-testid="crm-copilot-generate"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? 'Drafting…' : 'Generate draft'}
          </Button>
        </div>

        {error && (
          <div
            data-testid="crm-copilot-error"
            className="rounded-[var(--crm-radius-md)] border border-[var(--crm-danger)] bg-[var(--crm-danger-subtle)] px-3 py-2 text-[12px] text-[var(--crm-danger)]"
          >
            {error}
          </div>
        )}

        {/* Content drafts */}
        {content && (
          <div className="flex flex-col gap-4" data-testid="crm-copilot-content">
            <div className="flex flex-col gap-2">
              <span className={labelCls}>Email drafts</span>
              {content.emails.map((e, i) => {
                const key = `email:${i}`;
                return (
                  <div key={key} className={cardCls} data-testid={`crm-copilot-email-${i}`}>
                    <div className="text-[13px] font-medium text-[var(--crm-text-primary)]">{e.subject}</div>
                    <p className="mt-1 whitespace-pre-wrap text-[12px] text-[var(--crm-text-secondary)]">{e.body}</p>
                    <FlagWarning
                      flags={e.flags}
                      checked={acked[key] === true}
                      onToggle={(v) => setAcked((a) => ({ ...a, [key]: v }))}
                    />
                    <div className="mt-2 flex items-center justify-end">
                      {saved[key] ? (
                        <SavedTag />
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={savingKey === key || (e.flags.length > 0 && acked[key] !== true)}
                          data-testid={`crm-copilot-save-email-${i}`}
                          onClick={() => approve(key, { kind: 'email_template', subject: e.subject, body: e.body, flags: e.flags })}
                        >
                          {savingKey === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Save as draft
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-2">
              <span className={labelCls}>SMS drafts</span>
              {content.sms.map((s, i) => {
                const key = `sms:${i}`;
                const over = s.body.length > SMS_MAX_CHARS;
                return (
                  <div key={key} className={cardCls} data-testid={`crm-copilot-sms-${i}`}>
                    <p className="whitespace-pre-wrap text-[12px] text-[var(--crm-text-secondary)]">{s.body}</p>
                    <FlagWarning
                      flags={s.flags}
                      checked={acked[key] === true}
                      onToggle={(v) => setAcked((a) => ({ ...a, [key]: v }))}
                    />
                    <div className="mt-2 flex items-center justify-between">
                      <span
                        data-testid={`crm-copilot-sms-count-${i}`}
                        className={`text-[11px] ${over ? 'text-[var(--crm-warning)]' : 'text-[var(--crm-text-tertiary)]'}`}
                      >
                        {s.body.length}/{SMS_MAX_CHARS} chars
                      </span>
                      {saved[key] ? (
                        <SavedTag />
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={savingKey === key || (s.flags.length > 0 && acked[key] !== true)}
                          data-testid={`crm-copilot-save-sms-${i}`}
                          onClick={() => approve(key, { kind: 'sms_campaign', body: s.body, flags: s.flags })}
                        >
                          {savingKey === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Save as draft
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className={labelCls}>Campaign brief</span>
              <div className={cardCls} data-testid="crm-copilot-brief">
                <p className="whitespace-pre-wrap text-[12px] text-[var(--crm-text-secondary)]">{content.brief}</p>
              </div>
            </div>
          </div>
        )}

        {/* Automation plan (spec only — not provisioned) */}
        {plan && (
          <div className="flex flex-col gap-3" data-testid="crm-copilot-plan">
            <div className={cardCls}>
              <div className="grid grid-cols-[110px_1fr] gap-y-1 text-[12px]">
                <span className={labelCls}>Trigger</span>
                <span className="font-mono text-[var(--crm-text-primary)]">{plan.triggerEvent}</span>
                <span className={labelCls}>Audience</span>
                <span className="text-[var(--crm-text-secondary)]">{plan.audience}</span>
              </div>
            </div>
            <span className={labelCls}>Steps</span>
            <ol className="flex flex-col gap-1.5">
              {plan.steps.map((st, i) => (
                <li
                  key={i}
                  data-testid={`crm-copilot-step-${i}`}
                  className={`flex items-center gap-3 ${cardCls}`}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--crm-primary-subtle)] text-[11px] font-medium text-[var(--crm-primary)]">
                    {i + 1}
                  </span>
                  <span className="rounded-[var(--crm-radius-sm)] bg-[var(--crm-bg-tertiary)] px-1.5 py-0.5 text-[11px] font-medium uppercase text-[var(--crm-text-secondary)]">
                    {st.channel}
                  </span>
                  <span className="font-mono text-[12px] text-[var(--crm-text-primary)]">{st.templateKey}</span>
                  <span className="ml-auto text-[11px] text-[var(--crm-text-tertiary)]">+{st.delayHours}h</span>
                </li>
              ))}
            </ol>
            <p className="text-[11px] text-[var(--crm-text-tertiary)]">
              This is a human-buildable spec. No Make scenario is provisioned and nothing is activated.
            </p>
          </div>
        )}
      </div>
    </SlideOver>
  );
}
