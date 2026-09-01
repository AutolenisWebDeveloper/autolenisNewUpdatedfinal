"use client";

// Admin/concierge contract attachment control.
//
// The concierge track has no dealer, so the dealer's own upload surface can never
// serve it (assertDealerOwnsDeal gates on offer.dealerId, which is null for every
// concierge deal). Until this existed, attaching a contract to a concierge deal was
// reachable only by calling the API directly — the track was code-complete but not
// operationally usable.
//
// Posts multipart to /api/admin/deals/[dealId]/contract/upload-file, which stores
// the PDF in the private bucket AND creates the ContractVersion, starting the
// fail-closed Contract Shield scan. Success here means a scan is under way — it is
// deliberately NOT phrased as "approved".

import { useRef, useState } from "react";
import { Upload, CheckCircle2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

type State = "idle" | "uploading" | "done" | "error";

export default function AdminContractUpload({ dealId }: { dealId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>("idle");
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

      const res = await fetch(`/api/admin/deals/${dealId}/contract/upload-file`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(data?.error?.message ?? "Upload failed. Please try again.");
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
    <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="admin-contract-upload">
      <div className="flex items-center gap-2 mb-1">
        <FileText size={15} className="text-al-primary" />
        <h3 className="font-semibold text-slate-800 text-sm">Attach purchase contract</h3>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        PDF only, up to 20 MB. Uploading runs Contract Shield automatically; the deal
        moves forward only if the scan passes or an admin approves the review.
      </p>

      {error && (
        <p className="text-sm text-red-600 mb-3" data-testid="admin-contract-upload-error">{error}</p>
      )}

      {state === "done" ? (
        <div
          className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700"
          data-testid="admin-contract-upload-success"
        >
          <CheckCircle2 size={15} className="shrink-0" />
          Uploaded {fileName} — Contract Shield is scanning it now.
        </div>
      ) : (
        <Button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={state === "uploading"}
          size="sm"
          data-testid="admin-contract-upload-btn"
        >
          <Upload size={14} />
          {state === "uploading" ? "Uploading…" : "Upload contract PDF"}
        </Button>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={handleFileChange}
        className="hidden"
        data-testid="admin-contract-file-input"
      />
    </div>
  );
}
