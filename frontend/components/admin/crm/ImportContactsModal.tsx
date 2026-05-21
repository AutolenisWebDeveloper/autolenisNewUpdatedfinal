'use client';

import { useState } from 'react';
import { Loader2, X, Upload, Download } from 'lucide-react';

type Props = {
  onClose: () => void;
  onImported?: (result: { imported: number; duplicates_merged: number; errors: number }) => void;
};

const SAMPLE_CSV =
  'first_name,last_name,email,phone,source,consent_sms,consent_email\nJane,Doe,jane@example.com,+15555550100,import,false,true\nJohn,Smith,john@example.com,+15555550101,import,true,true\n';

type Row = Record<string, string>;
type ImportResult = {
  imported: number;
  duplicates_merged: number;
  errors: { row: number; error: string }[];
};

function parseHeaderAndPreview(text: string): { header: string[]; preview: Row[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { header: [], preview: [] };
  const header = lines[0].split(',').map((h) => h.trim());
  const rows = lines.slice(1, 6).map((line) => {
    const values = line.split(',');
    const obj: Row = {};
    header.forEach((h, i) => {
      obj[h] = (values[i] ?? '').trim();
    });
    return obj;
  });
  return { header, preview: rows };
}

export function ImportContactsModal({ onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [header, setHeader] = useState<string[]>([]);
  const [preview, setPreview] = useState<Row[]>([]);
  const [csvText, setCsvText] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const text = await f.text();
    setCsvText(text);
    const { header: h, preview: p } = parseHeaderAndPreview(text);
    setHeader(h);
    setPreview(p);
  }

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'autolenis-contacts-sample.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function runImport() {
    if (!csvText) return;
    setUploading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/crm/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: csvText,
      });
      const json = (await res.json()) as ImportResult & { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'IMPORT_FAILED');
        setUploading(false);
        return;
      }
      setResult(json);
      onImported?.({
        imported: json.imported,
        duplicates_merged: json.duplicates_merged,
        errors: json.errors?.length ?? 0,
      });
      setUploading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'IMPORT_FAILED');
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-2xl w-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Upload className="w-4 h-4 text-blue-600" /> Import Contacts (CSV)
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
          <div className="px-5 py-6 space-y-3">
            <p className="text-sm text-gray-900 font-medium">Import complete</p>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <div className="text-[11px] text-emerald-700 uppercase font-semibold">Imported</div>
                <div className="text-lg font-bold text-emerald-900 tabular-nums">{result.imported}</div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                <div className="text-[11px] text-blue-700 uppercase font-semibold">Merged</div>
                <div className="text-lg font-bold text-blue-900 tabular-nums">
                  {result.duplicates_merged}
                </div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <div className="text-[11px] text-red-700 uppercase font-semibold">Errors</div>
                <div className="text-lg font-bold text-red-900 tabular-nums">
                  {result.errors?.length ?? 0}
                </div>
              </div>
            </div>
            {result.errors && result.errors.length > 0 && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-40 overflow-y-auto text-xs text-gray-700">
                {result.errors.slice(0, 20).map((e, i) => (
                  <div key={i}>
                    Row {e.row}: {e.error}
                  </div>
                ))}
                {result.errors.length > 20 && (
                  <div className="text-gray-500">…and {result.errors.length - 20} more</div>
                )}
              </div>
            )}
            <div className="flex justify-end pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 py-4 space-y-4">
              <div className="flex items-center justify-between">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={onFileChange}
                  className="text-sm text-gray-700 file:mr-3 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-50"
                />
                <button
                  onClick={downloadSample}
                  className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700"
                >
                  <Download className="w-3.5 h-3.5" /> Sample CSV
                </button>
              </div>

              <p className="text-[11px] text-gray-500">
                Required columns: <code>first_name, last_name, email, phone, source, consent_sms,
                consent_email</code>. Email or phone is required per row.
              </p>

              {preview.length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        {header.map((h) => (
                          <th
                            key={h}
                            className="px-3 py-2 text-left font-semibold text-gray-600 uppercase tracking-wider"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {preview.map((row, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          {header.map((h) => (
                            <td key={h} className="px-3 py-1.5 text-gray-900 truncate max-w-[150px]">
                              {row[h] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-3 py-1.5 text-[11px] text-gray-500 bg-gray-50 border-t border-gray-200">
                    Preview of first {preview.length} row{preview.length === 1 ? '' : 's'}.
                  </div>
                </div>
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
              <button
                onClick={runImport}
                disabled={!file || uploading}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {uploading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Import
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
