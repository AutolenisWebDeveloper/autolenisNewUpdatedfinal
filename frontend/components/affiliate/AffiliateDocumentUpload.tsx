"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { UploadCloud } from "lucide-react";
import { AFFILIATE_DOCUMENT_MAX_BYTES } from "@/lib/constants";

const DOC_TYPES = [
  { value: "W9", label: "W-9 Tax Form" },
  { value: "GOVERNMENT_ID", label: "Government-Issued ID" },
  { value: "AGREEMENT", label: "Affiliate Agreement" },
  { value: "OTHER", label: "Other" },
] as const;

type DocType = typeof DOC_TYPES[number]["value"];

export default function AffiliateDocumentUpload() {
  const [type, setType] = useState<DocType>("W9");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setError(null);
    setSuccess(false);
    if (!f) { setFile(null); return; }
    if (f.size > AFFILIATE_DOCUMENT_MAX_BYTES) {
      setError("File must be under 10 MB.");
      setFile(null);
      return;
    }
    if (!["application/pdf", "image/jpeg", "image/png"].includes(f.type)) {
      setError("Only PDF, JPEG, and PNG files are allowed.");
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", type);
      const res = await fetch("/api/affiliate/documents/upload", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? "Upload failed.");
        return;
      }
      setSuccess(true);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Upload Document</p>

      <div className="space-y-4">
        <div>
          <label htmlFor="doc-type" className="text-sm text-slate-600 font-medium block mb-1.5">Document Type</label>
          <select
            id="doc-type"
            value={type}
            onChange={e => setType(e.target.value as DocType)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-al-primary/30"
          >
            {DOC_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="doc-file" className="text-sm text-slate-600 font-medium block mb-1.5">File (PDF, JPEG, PNG · max 10 MB)</label>
          <input
            ref={inputRef}
            id="doc-file"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={handleFileChange}
            className="block w-full text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-al-primary/10 file:text-al-primary hover:file:bg-al-primary/20"
          />
          {file && (
            <p className="text-xs text-slate-400 mt-1">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>
          )}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
        {success && <p className="text-xs text-green-600">Document uploaded successfully. It is now pending review.</p>}

        <Button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="w-full"
          data-testid="upload-document-btn"
        >
          <UploadCloud size={14} className="mr-2" />
          {uploading ? "Uploading…" : "Upload Document"}
        </Button>
      </div>
    </div>
  );
}
