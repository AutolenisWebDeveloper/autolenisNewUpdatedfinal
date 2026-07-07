"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CheckCircle2, Upload, AlertCircle } from "lucide-react";
import Link from "next/link";
import { api, apiErrorMessage } from "@/lib/api/client";

export default function ExternalPrequalPage() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ lenderName: "", approvedAmount: "", apr: "", termMonths: "", expiryDate: "", notes: "" });
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docUploading, setDocUploading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // Upload the lender letter FIRST so its stored path can be linked to the
      // submission — the reviewing admin verifies against this document. Upload
      // failure now blocks the submit and surfaces an error (previously it was
      // a fire-and-forget call whose failure was silently swallowed, and whose
      // returned path was discarded, orphaning the document).
      let documentUrl: string | undefined;
      if (docFile) {
        setDocUploading(true);
        try {
          const fd = new FormData();
          fd.append("file", docFile);
          fd.append("requestId", "external");
          // Multipart upload — the JSON api client can't carry FormData, so use
          // raw fetch but check the response and read the stored path.
          const res = await fetch("/api/buyer/requests/financing/upload-letter", {
            method: "POST",
            body: fd,
          });
          const json = (await res.json().catch(() => null)) as
            | { success?: boolean; data?: { url?: string }; error?: { message?: string } }
            | null;
          if (!res.ok || !json?.success || !json.data?.url) {
            throw new Error(json?.error?.message ?? "Document upload failed. Please try again.");
          }
          documentUrl = json.data.url;
        } finally {
          setDocUploading(false);
        }
      }

      await api.post("/api/buyer/prequal/external", {
        lenderName: form.lenderName,
        approvedAmountCents: Math.round(parseFloat(form.approvedAmount) * 100),
        apr: parseFloat(form.apr),
        termMonths: parseInt(form.termMonths, 10),
        expiresAt: form.expiryDate || undefined,
        documentUrl,
      });
      setSubmitted(true);
    } catch (err) {
      setError(apiErrorMessage(err, "Submission failed. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6 md:py-10 text-center" data-testid="external-prequal-success">
        <div className="w-16 h-16 rounded-2xl bg-al-success-subtle flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={30} className="text-al-success" />
        </div>
        <h2 className="text-2xl sm:text-[1.75rem] font-bold text-slate-900 tracking-tight mb-2">Pre-approval submitted</h2>
        <p className="text-slate-500 text-sm mb-6">Our team is reviewing your external pre-approval. You will be notified within 1 business day.</p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Button href="/buyer/prequal/manual-preapproval/status" data-testid="view-status-btn">Track review status</Button>
          <Button href="/buyer/dashboard" variant="outline" data-testid="back-to-dashboard-btn">Back to Dashboard</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6 md:py-10" data-testid="external-prequal-page">
      <h1 className="text-2xl sm:text-[1.75rem] font-bold text-slate-900 tracking-tight mb-2">I Have My Own Bank Financing</h1>
      <p className="text-sm text-slate-500 mb-6">Submit your pre-approval from your bank or credit union. We will verify it and update your buying power.</p>

      <form onSubmit={handleSubmit} data-testid="external-prequal-form" className="space-y-5">
        <div>
          <Label htmlFor="ep-lender">Lender name</Label>
          <Input id="ep-lender" data-testid="ep-lender-input" className="mt-1.5" placeholder="Chase Bank, Navy Federal…" value={form.lenderName} onChange={e => setForm({...form, lenderName: e.target.value})} required />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="ep-amount">Approved amount ($)</Label>
            <Input id="ep-amount" type="number" data-testid="ep-amount-input" className="mt-1.5" placeholder="30000" value={form.approvedAmount} onChange={e => setForm({...form, approvedAmount: e.target.value})} required />
          </div>
          <div>
            <Label htmlFor="ep-apr">APR (%)</Label>
            <Input id="ep-apr" type="number" step="0.01" data-testid="ep-apr-input" className="mt-1.5" placeholder="4.5" value={form.apr} onChange={e => setForm({...form, apr: e.target.value})} required />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="ep-term">Loan term (months)</Label>
            <Select id="ep-term" data-testid="ep-term-select" className="mt-1.5" value={form.termMonths} onChange={e => setForm({...form, termMonths: e.target.value})} required>
              <option value="">Select term</option>
              {[24, 36, 48, 60, 72, 84].map(m => <option key={m} value={m}>{m} months</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="ep-expiry">Approval expiry date</Label>
            <Input id="ep-expiry" type="date" data-testid="ep-expiry-input" className="mt-1.5" value={form.expiryDate} onChange={e => setForm({...form, expiryDate: e.target.value})} required />
          </div>
        </div>
        <div>
          <Label>Upload approval document (optional)</Label>
          <label
            className="mt-1.5 block border-2 border-dashed border-slate-200 rounded-lg p-6 text-center hover:border-al-primary/50 transition-colors cursor-pointer"
            data-testid="ep-upload-zone"
          >
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="sr-only"
              data-testid="ep-upload-input"
              onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
            />
            <Upload size={20} className="text-slate-400 mx-auto mb-2" />
            {docFile ? (
              <p className="text-sm text-slate-700 font-medium" data-testid="ep-upload-filename">{docFile.name}</p>
            ) : (
              <p className="text-sm text-slate-500">Click to upload your approval letter</p>
            )}
            <p className="text-xs text-slate-400 mt-0.5">PDF, JPG, PNG up to 10MB</p>
          </label>
        </div>
        {error && (
          <div
            className="flex items-start gap-3 bg-al-danger-subtle border border-al-danger/20 rounded-xl px-4 py-3"
            role="alert"
            data-testid="ep-error"
          >
            <AlertCircle size={18} className="text-al-danger mt-0.5 shrink-0" />
            <p className="text-sm text-al-danger-fg">{error}</p>
          </div>
        )}
        <Button type="submit" className="w-full" size="lg" disabled={loading || docUploading} data-testid="ep-submit-btn">
          {loading || docUploading ? "Submitting…" : "Submit Pre-Approval"}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <Link href="/buyer/prequal" className="text-sm text-slate-400 hover:underline" data-testid="use-autolenis-prequal-link">
          Use AutoLenis prequalification instead →
        </Link>
      </div>
    </div>
  );
}
