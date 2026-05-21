'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Save,
  Loader2,
  AlertTriangle,
  Eye,
  Code,
  History,
  ChevronLeft,
  CheckCircle2,
} from 'lucide-react';
import { useDebounce } from '@/lib/hooks/use-debounce';
import { cn } from '@/lib/utils';
import type {
  EmailTemplate,
  EmailTemplateCategory,
  EmailTemplateStatus,
  EmailTemplateVersion,
  RenderedTemplate,
} from '@/lib/types/crm';

const SUPPORTED_TOKENS = [
  'firstName', 'lastName', 'fullName',
  'vehicleMake', 'vehicleModel', 'vehicleYear',
  'dashboardUrl', 'depositUrl', 'auctionUrl', 'offerUrl',
  'supportEmail', 'unsubscribeUrl',
];

type Props =
  | { mode: 'create' }
  | { mode: 'edit'; template: EmailTemplate; versions: EmailTemplateVersion[] };

type FormState = {
  name: string;
  subject: string;
  category: EmailTemplateCategory;
  html_body: string;
  text_body: string;
  status: EmailTemplateStatus;
};

type PreviewResponse = {
  rendered: RenderedTemplate;
  warnings: { unknown_variables: string[]; missing_unsubscribe: boolean };
};

function emptyForm(): FormState {
  return {
    name: '',
    subject: '',
    category: 'transactional',
    html_body:
      '<p>Hi {{firstName}},</p>\n<p>Welcome to AutoLenis. Track your progress at <a href="{{dashboardUrl}}">your dashboard</a>.</p>\n<p>Questions? Reach us at {{supportEmail}}.</p>',
    text_body: '',
    status: 'draft',
  };
}

export function TemplateEditor(props: Props) {
  const router = useRouter();
  const initial = useMemo<FormState>(() => {
    if (props.mode === 'edit') {
      return {
        name: props.template.name,
        subject: props.template.subject,
        category: props.template.category,
        html_body: props.template.html_body,
        text_body: props.template.text_body ?? '',
        status: props.template.status,
      };
    }
    return emptyForm();
  }, [props]);

  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [view, setView] = useState<'preview' | 'html'>('preview');
  const previewSeq = useRef(0);

  const dirty = useMemo(() => {
    return (
      form.name !== initial.name ||
      form.subject !== initial.subject ||
      form.category !== initial.category ||
      form.html_body !== initial.html_body ||
      form.text_body !== initial.text_body ||
      form.status !== initial.status
    );
  }, [form, initial]);

  const debouncedForm = useDebounce(form, 400);

  // Live preview — refetches whenever the debounced form values change.
  useEffect(() => {
    if (!debouncedForm.subject || !debouncedForm.html_body) {
      setPreview(null);
      return;
    }
    const seq = ++previewSeq.current;
    setPreviewLoading(true);
    fetch('/api/admin/crm/templates/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: debouncedForm.subject,
        html_body: debouncedForm.html_body,
        text_body: debouncedForm.text_body || null,
        category: debouncedForm.category,
      }),
    })
      .then((r) => r.json())
      .then((json: PreviewResponse | { error: string }) => {
        if (seq !== previewSeq.current) return;
        if ('rendered' in json) setPreview(json);
      })
      .finally(() => {
        if (seq === previewSeq.current) setPreviewLoading(false);
      });
  }, [debouncedForm]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function insertToken(token: string) {
    const wrapped = `{{${token}}}`;
    setForm((prev) => ({ ...prev, html_body: prev.html_body + wrapped }));
  }

  async function handleSave() {
    if (saving) return;
    setError(null);

    if (!form.name.trim() || !form.subject.trim() || !form.html_body.trim()) {
      setError('Name, subject, and HTML body are required.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        subject: form.subject.trim(),
        category: form.category,
        html_body: form.html_body,
        text_body: form.text_body || null,
        status: form.status,
      };

      const url =
        props.mode === 'create'
          ? '/api/admin/crm/templates'
          : `/api/admin/crm/templates/${props.template.id}`;
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

      const json = (await res.json()) as { template: EmailTemplate };
      setSavedAt(Date.now());

      if (props.mode === 'create') {
        router.push(`/admin/crm/templates/${json.template.id}/edit`);
      } else {
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/crm/templates"
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Templates
          </Link>
          <span className="text-gray-400">/</span>
          <h1 className="text-base font-bold text-gray-900">
            {props.mode === 'create' ? 'New template' : props.template.name}
          </h1>
          {props.mode === 'edit' && (
            <span className="text-[11px] text-gray-500 font-mono">
              v{props.template.version}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {savedAt && (
            <span className="flex items-center gap-1 text-[11px] text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5" /> Saved
            </span>
          )}
          {dirty && !savedAt && (
            <span className="text-[11px] text-yellow-500">Unsaved changes</span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-gray-900 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {props.mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-xs text-red-700 mb-4 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Editor column */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              Name
            </label>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Welcome email"
              className="mt-1 w-full bg-white border border-gray-200 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Category
              </label>
              <select
                value={form.category}
                onChange={(e) => set('category', e.target.value as EmailTemplateCategory)}
                className="mt-1 w-full bg-white border border-gray-200 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-gray-900 transition-colors"
              >
                <option value="transactional">Transactional</option>
                <option value="marketing">Marketing</option>
                <option value="automation">Automation</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Status
              </label>
              <select
                value={form.status}
                onChange={(e) => set('status', e.target.value as EmailTemplateStatus)}
                className="mt-1 w-full bg-white border border-gray-200 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-gray-900 transition-colors"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              Subject
            </label>
            <input
              value={form.subject}
              onChange={(e) => set('subject', e.target.value)}
              placeholder="Welcome to AutoLenis, {{firstName}}"
              className="mt-1 w-full bg-white border border-gray-200 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                HTML body
              </label>
              <div className="text-[10px] text-gray-500">
                {form.html_body.length.toLocaleString()} chars
              </div>
            </div>
            <textarea
              value={form.html_body}
              onChange={(e) => set('html_body', e.target.value)}
              rows={14}
              spellCheck={false}
              className="mt-1 w-full bg-white border border-gray-200 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-xs text-gray-900 font-mono placeholder-gray-400 resize-y transition-colors"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              Plain text body (optional)
            </label>
            <textarea
              value={form.text_body}
              onChange={(e) => set('text_body', e.target.value)}
              rows={4}
              spellCheck={false}
              placeholder="Auto-generated from HTML when blank"
              className="mt-1 w-full bg-white border border-gray-200 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-xs text-gray-900 font-mono placeholder-gray-400 resize-y transition-colors"
            />
          </div>

          <div>
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Available variables
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SUPPORTED_TOKENS.map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => insertToken(token)}
                  className="text-[10px] font-mono bg-blue-500/10 hover:bg-blue-100 border border-blue-500/30 text-blue-700 px-2 py-0.5 rounded transition-colors"
                >
                  {`{{${token}}}`}
                </button>
              ))}
            </div>
          </div>

          {props.mode === 'edit' && props.versions.length > 0 && (
            <div className="border-t border-gray-200 pt-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                <History className="w-3 h-3" /> Version history
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {props.versions.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between text-xs px-2 py-1.5 rounded hover:bg-gray-100/40"
                  >
                    <span className="font-mono text-gray-500">v{v.version}</span>
                    <span className="text-gray-500 truncate max-w-xs">{v.subject}</span>
                    <span className="text-[10px] text-gray-500">
                      {new Date(v.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Preview column */}
        <div className="bg-white border border-gray-200 rounded-xl flex flex-col min-h-[500px]">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
            <div className="flex bg-white border border-gray-200 rounded-md p-0.5 text-[10px] font-medium">
              <button
                onClick={() => setView('preview')}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded',
                  view === 'preview' ? 'bg-gray-50 text-gray-900' : 'text-gray-500',
                )}
              >
                <Eye className="w-3 h-3" /> Preview
              </button>
              <button
                onClick={() => setView('html')}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded',
                  view === 'html' ? 'bg-gray-50 text-gray-900' : 'text-gray-500',
                )}
              >
                <Code className="w-3 h-3" /> HTML
              </button>
            </div>
            {previewLoading && <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />}
          </div>

          {preview?.warnings && (
            <div className="px-5 py-2 border-b border-gray-200 space-y-1">
              {preview.warnings.missing_unsubscribe && (
                <div className="flex items-start gap-2 text-[11px] text-yellow-700">
                  <AlertTriangle className="w-3 h-3 mt-0.5" />
                  Marketing template missing {`{{unsubscribeUrl}}`} — footer will be auto-appended,
                  but inline unsubscribe is recommended.
                </div>
              )}
              {preview.warnings.unknown_variables.length > 0 && (
                <div className="flex items-start gap-2 text-[11px] text-yellow-700">
                  <AlertTriangle className="w-3 h-3 mt-0.5" />
                  Unknown variables:{' '}
                  <span className="font-mono">
                    {preview.warnings.unknown_variables.join(', ')}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="px-5 py-3 border-b border-gray-200">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Subject</div>
            <div className="text-sm text-gray-900 truncate">
              {preview?.rendered.subject ?? form.subject ?? '—'}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {!preview ? (
              <div className="flex items-center justify-center h-full text-xs text-gray-500">
                Preview appears once the subject and HTML are filled in.
              </div>
            ) : view === 'preview' ? (
              <iframe
                title="template-preview"
                srcDoc={preview.rendered.html}
                className="w-full h-full min-h-[400px] bg-white"
                sandbox=""
              />
            ) : (
              <pre className="text-[11px] text-gray-400 font-mono p-4 whitespace-pre-wrap break-words">
                {preview.rendered.html}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
