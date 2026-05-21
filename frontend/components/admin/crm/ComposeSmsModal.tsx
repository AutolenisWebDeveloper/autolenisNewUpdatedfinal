'use client';

import { useState } from 'react';
import { Loader2, X, MessageSquare } from 'lucide-react';

type Props = {
  contactId: string;
  contactPhone: string;
  consentSms: boolean;
  contactName?: string;
  onClose: () => void;
};

function segmentsFor(text: string): number {
  if (!text) return 0;
  // GSM-7 / unicode threshold: anything outside basic ASCII shifts to 70-char segments.
  // Simple heuristic — exact carrier behavior varies.
  const unicode = /[^\x00-\x7F]/.test(text);
  const segLen = unicode ? 70 : 160;
  const multiSegLen = unicode ? 67 : 153;
  if (text.length <= segLen) return 1;
  return Math.ceil(text.length / multiSegLen);
}

export function ComposeSmsModal({ contactId, contactPhone, consentSms, contactName, onClose }: Props) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const charCount = body.length;
  const segCount = segmentsFor(body);
  const disabled = !consentSms;

  async function send() {
    if (disabled) return;
    if (!body.trim()) {
      setError('Message body is required');
      return;
    }
    setError(null);
    setSending(true);
    try {
      const res = await fetch(`/api/admin/crm/contacts/${contactId}/send-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'SEND_FAILED');
        setSending(false);
        return;
      }
      onClose();
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
            <MessageSquare className="w-4 h-4 text-blue-600" /> Send SMS
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-500 hover:text-gray-900 rounded hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700">To</label>
            <input
              type="tel"
              value={contactPhone}
              readOnly
              className="mt-1 w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 cursor-not-allowed"
            />
            {contactName && <p className="text-xs text-gray-500 mt-1">{contactName}</p>}
          </div>

          {disabled && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs rounded-lg px-3 py-2"
              title="Contact has not opted in to SMS">
              This contact has not opted in to SMS. The send button is disabled.
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-700">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              disabled={disabled}
              placeholder="Type your SMS message…"
              className="mt-1 w-full bg-white border border-gray-300 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 resize-y disabled:bg-gray-50 disabled:cursor-not-allowed"
            />
            <div className="flex items-center justify-between text-[11px] text-gray-500 mt-1">
              <span>Reply STOP to unsubscribe will be appended automatically.</span>
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
            disabled={sending || disabled}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {sending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Send SMS
          </button>
        </div>
      </div>
    </div>
  );
}
