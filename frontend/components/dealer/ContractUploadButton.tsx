"use client";

import { useRef, useState } from "react";
import { Upload, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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
          className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700"
          data-testid="contract-upload-success"
        >
          <CheckCircle2 size={15} className="shrink-0" /> Uploaded: {fileName}
        </div>
      ) : (
        <Button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={state === "uploading"}
          size="lg"
          className="w-full"
          data-testid="upload-contract-btn"
        >
          <Upload size={16} />
          {state === "uploading" ? "Uploading..." : "Upload & Submit for Review"}
        </Button>
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
