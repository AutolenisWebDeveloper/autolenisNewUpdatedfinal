"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";

interface Props {
  dealId: string;
}

type UploadState = "idle" | "uploading" | "done" | "error";

export default function ContractUploadButton({ dealId }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setState("uploading");
    setError(null);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("dealId", dealId);

      const res = await fetch("/api/dealer/contracts/upload-file", {
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
    } catch {
      setError("Network error. Please try again.");
      setState("error");
    }
  }

  return (
    <div data-testid="contract-upload-button">
      {error && (
        <p className="text-sm text-red-600 mb-3" data-testid="contract-upload-error">
          {error}
        </p>
      )}

      {state === "done" ? (
        <div
          className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700"
          data-testid="contract-upload-success"
        >
          <span>✓ Uploaded: {fileName}</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={state === "uploading"}
          className="w-full flex items-center justify-center gap-2 bg-[#0B5FD1] hover:bg-[#1A6FE0] disabled:opacity-50 text-white font-semibold py-3 px-6 rounded-lg transition-colors text-sm"
          data-testid="upload-contract-btn"
        >
          <Upload size={16} />
          {state === "uploading" ? "Uploading..." : "Upload & Submit for Review"}
        </button>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={handleFileChange}
        className="hidden"
        data-testid="contract-file-input"
      />
    </div>
  );
}
