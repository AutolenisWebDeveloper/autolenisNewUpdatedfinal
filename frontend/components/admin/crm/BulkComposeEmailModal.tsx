'use client';

import { useEffect, useState } from 'react';
import { Loader2, X, Mail } from 'lucide-react';
import type { EmailTemplate } from '@/lib/types/crm';

type Props = {
  contactIds: string[];
  onClose: () => void;
  onSent?: (queued: number) => void;
};

export function BulkComposeEmailModal({ contactIds, onClose, onSent }: Props) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [consentCheck, setConsentCheck] = useState<{
    eligible: number;
    no_consent: number;
    no_email: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ queued: number; total: number } | null>(null);

  useEffect(() => {
    fetch('/api/admin/crm/templates?status=active')
      .then((r) => r.json())
      .then((json) => setTemplates((json.data as EmailTemplate[]) ?? []))
      .catch(() => setTemplates([]));
  }, []);

  // Pre-send consent/eligibility preview over the exact selection — the
  // bulk-send endpoint enforces the same gates server-side.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/crm/contacts?ids=${encodeURIComponent(contactIds.join(','))}`,
          { method: 'GET' },
        );
        if (!res.ok) return;
        const json = await res.json();
        const filtered = (json.data ?? []) as Array<{
          id: string;
          email: string | null;
          consent_email: boolean;
        }>;
        const eligible = filtered.filter((c) => c.email && c.consent_email).length;
        const no_consent = filtered.filter((c) => c.email && !c.consent_email).length;
        const no_email = filtered.filter((c) => !c.email).length;
        if (!cancelled) setConsentCheck({ eligible, no_consent, no_email });
      } catch {
        // best-effort preview
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contactIds]);

  const usingTemplate = templateId !== '';

  async function send() {
    setError(null);
    setSending(true);
    try {
      const payload: Record<string, unknown> = {
        name: `Ad-hoc email - ${new Date().toLocaleString('en-US')}`,
        type: 'email',
        contact_ids: contactIds,
      };
      if (usingTemplate) {
        payload.template_id = templateId;
      } else {
        if (!subject.trim() || !body.trim()) {
          setError('Subject and body are required');
          setSending(false);
          return;
        }
        payload.subject = subject;
        payload.html_body = body.replace(/\n/g, '<br>');
        payload.text_body = body;
      }

      const res = await fetch('/api/admin/crm/campaigns/bulk-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'SEND_FAILED');
        setSending(false);
        return;
      }
      setResult({ queued: json.queued, total: json.total });
      onSent?.(json.queued);
      setSending(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SEND_FAILED');
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-lg w-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Mail className="w-4 h-4 text-blue-600" /> Email {contactIds.length} contact
            {contactIds.length === 1 ? '' : 's'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-500 hover:text-gray-900 rounded hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {result ? (
          <div className="px-5 py-6 text-center space-y-2">
            <p className="text-sm text-gray-900 font-medium">
              Queued {result.queued} of {result.total} contacts
            </p>
            <p className="text-xs text-gray-500">
              Contacts with no email, no email consent, suppression, or DNC flags were skipped.
            </p>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="px-5 py-4 space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
                Sending to <span className="font-semibold">{contactIds.length}</span> selected
                contact{contactIds.length === 1 ? '' : 's'}.
              </div>

              {consentCheck && (consentCheck.no_consent > 0 || consentCheck.no_email > 0) && (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs rounded-lg px-3 py-2 space-y-0.5">
                  {consentCheck.no_consent > 0 && (
                    <div>
                      {consentCheck.no_consent} of {contactIds.length} contacts have not opted in to
                      marketing email and will be excluded.
                    </div>
                  )}
                  {consentCheck.no_email > 0 && (
                    <div>
                      {consentCheck.no_email} of {contactIds.length} contacts have no email address
                      and will be excluded.
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-700">Template</label>
                <select
                  value={templateId}
                  onChange={(e) => { setTemplateId(e.target.value); setConfirming(false); }}
                  className="mt-1 w-full bg-white border border-gray-300 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-gray-900"
                >
                  <option value="">Custom message</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              {!usingTemplate && (
                <>
                  <div>
                    <label className="text-xs font-medium text-gray-700">Subject</label>
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => { setSubject(e.target.value); setConfirming(false); }}
                      placeholder="Email subject…"
                      className="mt-1 w-full bg-white border border-gray-300 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">Message</label>
                    <textarea
                      value={body}
                      onChange={(e) => { setBody(e.target.value); setConfirming(false); }}
                      rows={6}
                      placeholder="Type your message…"
                      className="mt-1 w-full bg-white border border-gray-300 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 resize-y"
                    />
                  </div>
                </>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
              >
                Cancel
              </button>
              {!confirming ? (
                <button
                  onClick={() => setConfirming(true)}
                  disabled={sending || (!usingTemplate && (!subject.trim() || !body.trim()))}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  Review &amp; confirm…
                </button>
              ) : (
                <button
                  onClick={send}
                  disabled={sending}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {sending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Confirm — email {consentCheck ? consentCheck.eligible : contactIds.length} eligible
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
