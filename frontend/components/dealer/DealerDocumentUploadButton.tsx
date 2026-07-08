"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

type UploadState = "idle" | "uploading" | "done" | "error";

interface DealOption {
  id: string;
  label: string;
}

// Document categories a dealer uploads against a deal. Values map to the
// Prisma DocumentType enum; the API validates and falls back to OTHER.
const DOC_TYPES: { value: string; label: string }[] = [
  { value: "SALES_CONTRACT", label: "Sales Contract / Buyer Order" },
  { value: "FINANCE_AGREEMENT", label: "Finance Agreement" },
  { value: "INSURANCE_PROOF", label: "Proof of Insurance" },
  { value: "TRADE_IN_TITLE", label: "Trade-in Title" },
  { value: "OTHER", label: "Other" },
];

export default function DealerDocumentUploadButton({ deals = [] }: { deals?: DealOption[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string>("");
  const [docType, setDocType] = useState<string>("OTHER");
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
      form.append("type", docType);
      if (dealId) form.append("dealId", dealId);

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
    <div className="flex flex-col items-end gap-1.5" data-testid="dealer-doc-upload-button">
      {error && (
        <p className="text-xs text-al-danger" role="alert" data-testid="dealer-doc-upload-error">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Select
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
          disabled={state === "uploading"}
          className="text-sm"
          data-testid="dealer-doc-type-select"
          aria-label="Document type"
        >
          {DOC_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </Select>

        {deals.length > 0 && (
          <Select
            value={dealId}
            onChange={(e) => setDealId(e.target.value)}
            disabled={state === "uploading"}
            className="text-sm max-w-[16rem]"
            data-testid="dealer-doc-deal-select"
            aria-label="Associate with deal"
          >
            <option value="">No deal (general)</option>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </Select>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={state === "uploading"}
          data-testid="dealer-upload-doc-btn"
        >
          <Upload size={14} />
          {state === "uploading" ? "Uploading..." : state === "done" ? "Uploaded!" : "Upload"}
        </Button>
      </div>

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
