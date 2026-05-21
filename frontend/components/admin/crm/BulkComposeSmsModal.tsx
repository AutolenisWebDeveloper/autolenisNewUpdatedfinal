'use client';

import { useEffect, useState } from 'react';
import { Loader2, X, MessageSquare } from 'lucide-react';

type Props = {
  contactIds: string[];
  onClose: () => void;
  onSent?: (queued: number) => void;
};

function segmentsFor(text: string): number {
  if (!text) return 0;
  const unicode = /[^\x00-\x7F]/.test(text);
  const segLen = unicode ? 70 : 160;
  const multiSegLen = unicode ? 67 : 153;
  if (text.length <= segLen) return 1;
  return Math.ceil(text.length / multiSegLen);
}

export function BulkComposeSmsModal({ contactIds, onClose, onSent }: Props) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentCheck, setConsentCheck] = useState<{
    eligible: number;
    no_consent: number;
    no_phone: number;
  } | null>(null);
  const [result, setResult] = useState<{ queued: number; total: number } | null>(null);

  // Up-front count of how many of the selected contacts have SMS consent.
  // The bulk-send endpoint enforces this gate; this is a UX preview.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/crm/contacts?per_page=100', {
          method: 'GET',
        });
        if (!res.ok) return;
        const json = await res.json();
        const all = (json.data ?? []) as Array<{
          id: string;
          phone: string | null;
          consent_sms: boolean;
        }>;
        const filtered = all.filter((c) => contactIds.includes(c.id));
        const eligible = filtered.filter((c) => c.phone && c.consent_sms).length;
        const no_consent = filtered.filter((c) => c.phone && !c.consent_sms).length;
        const no_phone = filtered.filter((c) => !c.phone).length;
        if (!cancelled) setConsentCheck({ eligible, no_consent, no_phone });
      } catch {
        // best-effort preview
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contactIds]);

  const charCount = body.length;
  const segCount = segmentsFor(body);

  async function send() {
    if (!body.trim()) {
      setError('Message body is required');
      return;
    }
    setError(null);
    setSending(true);
    try {
      const res = await fetch('/api/admin/crm/campaigns/bulk-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Ad-hoc SMS - ${new Date().toLocaleString('en-US')}`,
          type: 'sms',
          contact_ids: contactIds,
          sms_body: body.trim(),
        }),
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
            <MessageSquare className="w-4 h-4 text-blue-600" /> SMS {contactIds.length} contact
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
              Contacts without SMS consent, with no phone, or DNC flags were skipped.
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

              {consentCheck && (consentCheck.no_consent > 0 || consentCheck.no_phone > 0) && (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs rounded-lg px-3 py-2 space-y-0.5">
                  {consentCheck.no_consent > 0 && (
                    <div>
                      {consentCheck.no_consent} of {contactIds.length} contacts have not opted in
                      to SMS and will be excluded.
                    </div>
                  )}
                  {consentCheck.no_phone > 0 && (
                    <div>
                      {consentCheck.no_phone} of {contactIds.length} contacts have no phone number
                      and will be excluded.
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-700">Message</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={5}
                  placeholder="Type your SMS message…"
                  className="mt-1 w-full bg-white border border-gray-300 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 resize-y"
                />
                <div className="flex items-center justify-between text-[11px] text-gray-500 mt-1">
                  <span>STOP appended automatically.</span>
                  <span className="tabular-nums">
                    {charCount} chars · {segCount} segment{segCount === 1 ? '' : 's'}
                  </span>
                </div>
              </div>

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
              <button
                onClick={send}
                disabled={sending}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {sending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Send to {contactIds.length}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
