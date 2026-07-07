"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2 } from "lucide-react";

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const ALLOWED_EXT   = ".pdf,.jpg,.jpeg,.png,.webp";
const MAX_BYTES     = 10 * 1024 * 1024; // 10 MB

const DOCUMENT_TYPES = [
  { value: "DRIVERS_LICENSE",     label: "Driver's License" },
  { value: "INSURANCE_PROOF",     label: "Proof of Insurance" },
  { value: "INCOME_VERIFICATION", label: "Income Verification / Pay Stub" },
  { value: "BANK_STATEMENT",      label: "Bank Statement" },
  { value: "TRADE_IN_TITLE",      label: "Trade-In Title" },
  { value: "OTHER",               label: "Other" },
] as const;

export default function DocumentUploadButton() {
  const router   = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [docType,  setDocType]  = useState<string>("OTHER");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [success,  setSuccess]  = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Only PDF, JPG, PNG, or WEBP files accepted.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File must be under 10 MB.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file",    file);
      form.append("docType", docType);
      const res  = await fetch("/api/buyer/documents/upload", { method: "POST", body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: { message: string } } | null;
        setError(data?.error?.message ?? "Upload failed. Please try again.");
        return;
      }
      const data = await res.json() as { success: boolean; error?: { message: string } };
      if (!data.success) {
        setError(data.error?.message ?? "Upload failed. Please try again.");
      } else {
        setSuccess(`${file.name} uploaded successfully.`);
        setExpanded(false);
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      {!expanded ? (
        <button
          onClick={() => { setExpanded(true); setSuccess(null); }}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-al-primary text-white font-semibold text-sm rounded-xl hover:bg-al-primary-hover transition-colors"
          data-testid="upload-doc-btn"
        >
          <Upload size={14} /> Upload Document
        </button>
      ) : (
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 space-y-3">
          <p className="text-sm font-semibold text-[#111827]">Upload a Document</p>
          <select
            value={docType}
            onChange={e => setDocType(e.target.value)}
            className="w-full border border-[#D1D5DB] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary"
            data-testid="doc-type-select"
          >
            {DOCUMENT_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_EXT}
            className="sr-only"
            onChange={handleFile}
            data-testid="doc-file-input"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => inputRef.current?.click()}
              disabled={loading}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-al-primary text-white font-semibold text-sm rounded-xl hover:bg-al-primary-hover disabled:opacity-60 transition-colors"
              data-testid="doc-select-file-btn"
            >
              {loading ? (
                <><Loader2 size={14} className="animate-spin" />Uploading…</>
              ) : (
                <><Upload size={14} />Choose File</>
              )}
            </button>
            <button
              onClick={() => { setExpanded(false); setError(null); }}
              className="px-4 py-2.5 text-sm text-[#6B7280] hover:text-[#374151] transition-colors"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-red-600" data-testid="doc-upload-error">{error}</p>}
          <p className="text-xs text-[#9CA3AF]">PDF, JPG, PNG, WEBP · Max 10 MB</p>
        </div>
      )}
      {success && (
        <p className="text-xs font-semibold text-[#10B981] mt-2" data-testid="doc-upload-success">
          ✓ {success}
        </p>
      )}
    </div>
  );
}
