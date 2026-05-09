"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";

interface Props {
  dealId: string;
}

export default function InsuranceUploadButton({ dealId }: Props) {
  const router   = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side validation
    const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
    if (!allowedTypes.includes(file.type)) {
      setError("Only PDF, JPG, and PNG files are accepted.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File must be 10 MB or smaller.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file",   file);
      formData.append("dealId", dealId);

      const res  = await fetch("/api/buyer/insurance/upload-proof", {
        method: "POST",
        body:   formData,
      });
      const data = await res.json() as { success: boolean; error?: { message: string } };

      if (!data.success) {
        setError(data.error?.message ?? "Upload failed. Please try again.");
      } else {
        setSuccess(true);
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
      // Reset input so the same file can be re-selected if needed
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  if (success) {
    return (
      <p className="text-sm font-semibold text-[#10B981]" data-testid="upload-proof-success">
        ✓ Proof submitted — our team will review shortly.
      </p>
    );
  }

  return (
    <div data-testid="insurance-upload-button-container">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        className="hidden"
        data-testid="upload-proof-input"
        onChange={handleFileChange}
      />
      <button
        type="button"
        disabled={loading}
        onClick={() => inputRef.current?.click()}
        data-testid="upload-proof-btn"
        className="flex items-center gap-2 px-4 py-2.5 bg-white border border-[#D1D5DB] text-[#374151] font-semibold text-sm rounded-xl hover:bg-[#F8F9FB] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? (
          <><Loader2 size={14} className="animate-spin" /> Uploading…</>
        ) : (
          <><Upload size={14} /> Upload Proof</>
        )}
      </button>
      {error && (
        <p className="mt-2 text-xs text-red-600" data-testid="upload-proof-error">{error}</p>
      )}
    </div>
  );
}
