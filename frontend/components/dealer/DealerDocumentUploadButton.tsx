"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";

type UploadState = "idle" | "uploading" | "done" | "error";

export default function DealerDocumentUploadButton() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setState("uploading");
    setError(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/dealer/documents/upload", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } };
        setError(data.error?.message ?? "Upload failed. Please try again.");
        setState("error");
        return;
      }

      setState("done");
      router.refresh();
      // Reset after a moment so the button can be used again
      resetTimerRef.current = setTimeout(() => {
        setState("idle");
        if (fileRef.current) fileRef.current.value = "";
        resetTimerRef.current = null;
      }, 2000);
    } catch {
      setError("Network error. Please try again.");
      setState("error");
    }
  }

  return (
    <div data-testid="dealer-doc-upload-button">
      {error && (
        <p className="text-xs text-red-600 mb-1" data-testid="dealer-doc-upload-error">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={state === "uploading"}
        className="flex items-center gap-1.5 text-sm bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-medium px-3 py-1.5 rounded-lg transition-colors"
        data-testid="dealer-upload-doc-btn"
      >
        <Upload size={14} />
        {state === "uploading" ? "Uploading..." : state === "done" ? "Uploaded!" : "Upload"}
      </button>

      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        className="hidden"
        data-testid="dealer-doc-file-input"
      />
    </div>
  );
}
