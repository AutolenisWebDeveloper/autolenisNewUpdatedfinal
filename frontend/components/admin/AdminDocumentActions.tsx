"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ExternalLink, Check, X, Loader2 } from "lucide-react";

interface Props {
  documentId: string;
  status: string;
}

export default function AdminDocumentActions({ documentId, status }: Props) {
  const router = useRouter();
  const [viewLoading, setViewLoading] = useState(false);
  const [approveLoading, setApproveLoading] = useState(false);
  const [rejectLoading, setRejectLoading] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleView() {
    setViewLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/affiliates/documents/${documentId}/signed-url`);
      const json = await res.json();
      if (!res.ok) { setError(json?.error?.message ?? "Failed to load document."); return; }
      window.open(json.data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      setError("Failed to load document.");
    } finally {
      setViewLoading(false);
    }
  }

  async function handleApprove() {
    setApproveLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/affiliates/documents/${documentId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "APPROVED", reason: "Reviewed and approved" }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json?.error?.message ?? "Approve failed."); return; }
      router.refresh();
    } catch {
      setError("Approve failed.");
    } finally {
      setApproveLoading(false);
    }
  }

  async function handleRejectSubmit() {
    if (rejectReason.trim().length < 5) { setError("Reason must be at least 5 characters."); return; }
    setRejectLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/affiliates/documents/${documentId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "REJECTED", reason: rejectReason.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json?.error?.message ?? "Reject failed."); return; }
      setShowRejectModal(false);
      setRejectReason("");
      router.refresh();
    } catch {
      setError("Reject failed.");
    } finally {
      setRejectLoading(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {/* View button — always shown */}
        <Button variant="outline" size="sm" onClick={handleView} disabled={viewLoading} className="h-7 px-2.5 text-xs">
          {viewLoading ? <Loader2 size={11} className="animate-spin" /> : <ExternalLink size={11} className="mr-1" />}
          View
        </Button>

        {/* Approve — shown when PENDING or REJECTED */}
        {(status === "PENDING" || status === "REJECTED") && (
          <Button variant="secondary" size="sm" onClick={handleApprove} disabled={approveLoading} className="h-7 px-2.5 text-xs text-green-700 hover:bg-green-50">
            {approveLoading ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} className="mr-1" />}
            Approve
          </Button>
        )}

        {/* Reject — shown when PENDING or APPROVED */}
        {(status === "PENDING" || status === "APPROVED") && (
          <Button variant="secondary" size="sm" onClick={() => { setShowRejectModal(true); setError(null); }} className="h-7 px-2.5 text-xs text-red-700 hover:bg-red-50">
            <X size={11} className="mr-1" />
            Reject
          </Button>
        )}
      </div>

      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}

      {/* Reject modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowRejectModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800 mb-4">Reject Document</h3>
            <label className="text-sm text-slate-600 block mb-1.5">Reason for rejection</label>
            <textarea
              value={rejectReason}
              onChange={e => { setRejectReason(e.target.value); setError(null); }}
              rows={3}
              placeholder="Describe why this document is being rejected…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30"
            />
            {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
            <div className="flex items-center justify-end gap-3 mt-4">
              <Button variant="secondary" size="sm" onClick={() => setShowRejectModal(false)}>Cancel</Button>
              <Button size="sm" onClick={handleRejectSubmit} disabled={rejectLoading} className="bg-red-600 hover:bg-red-700 text-white">
                {rejectLoading ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
                Reject
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
