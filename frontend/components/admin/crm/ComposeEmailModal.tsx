'use client';

import { useEffect, useState } from 'react';
import { Loader2, X, Mail } from 'lucide-react';
import type { EmailTemplate } from '@/lib/types/crm';

type Props = {
  contactId: string;
  contactEmail: string;
  contactName?: string;
  onClose: () => void;
};

export function ComposeEmailModal({ contactId, contactEmail, contactName, onClose }: Props) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/crm/templates?status=active')
      .then((r) => r.json())
      .then((json) => setTemplates((json.data as EmailTemplate[]) ?? []))
      .catch(() => setTemplates([]));
  }, []);

  const usingTemplate = templateId !== '';
  const selectedTemplate = templates.find((t) => t.id === templateId);

  async function send() {
    setError(null);
    setSending(true);
    try {
      const payload: Record<string, unknown> = {};
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

      const res = await fetch(`/api/admin/crm/contacts/${contactId}/send-email`, {
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
            <Mail className="w-4 h-4 text-blue-600" /> Send Email
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
              type="email"
              value={contactEmail}
              readOnly
              className="mt-1 w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 cursor-not-allowed"
            />
            {contactName && <p className="text-xs text-gray-500 mt-1">{contactName}</p>}
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700">Template</label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
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

          {!usingTemplate ? (
            <>
              <div>
                <label className="text-xs font-medium text-gray-700">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Email subject…"
                  className="mt-1 w-full bg-white border border-gray-300 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">Message</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={6}
                  placeholder="Type your message…"
                  className="mt-1 w-full bg-white border border-gray-300 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 resize-y"
                />
              </div>
            </>
          ) : selectedTemplate ? (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700">
              <div className="font-medium text-gray-900 mb-1">{selectedTemplate.subject}</div>
              <div className="text-gray-500 line-clamp-4">
                {selectedTemplate.text_body || 'HTML template preview not shown here.'}
              </div>
            </div>
          ) : null}

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
            Send Email
          </button>
        </div>
      </div>
    </div>
  );
}
