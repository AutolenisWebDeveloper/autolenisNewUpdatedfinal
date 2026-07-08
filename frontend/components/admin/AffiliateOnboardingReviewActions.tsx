"use client";

import { toast } from "sonner";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api, apiErrorMessage } from "@/lib/api/client";

type Decision = "APPROVE" | "REJECT" | "REQUEST_CORRECTION";

const DECISION_COPY: Record<Decision, { title: string; confirmLabel: string; variant: "default" | "destructive" | "secondary"; noteRequired: boolean; notePlaceholder: string }> = {
  APPROVE: {
    title: "Approve onboarding",
    confirmLabel: "Approve",
    variant: "default",
    noteRequired: false,
    notePlaceholder: "Optional note (recorded to the audit log)…",
  },
  REQUEST_CORRECTION: {
    title: "Request corrections",
    confirmLabel: "Request correction",
    variant: "secondary",
    noteRequired: true,
    notePlaceholder: "Explain what the affiliate must correct (shown to them)…",
  },
  REJECT: {
    title: "Reject onboarding",
    confirmLabel: "Reject",
    variant: "destructive",
    noteRequired: true,
    notePlaceholder: "Explain why this onboarding is rejected (recorded to the audit log)…",
  },
};

function ReviewModal({
  decision,
  onConfirm,
  onClose,
  loading,
}: {
  decision: Decision;
  onConfirm: (note: string, correctionItems: string[]) => Promise<void>;
  onClose: () => void;
  loading: boolean;
}) {
  const copy = DECISION_COPY[decision];
  const [note, setNote] = useState("");
  const [items, setItems] = useState("");
  const canConfirm = !copy.noteRequired || note.trim().length >= 10;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label={copy.title}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">{copy.title}</h2>

        <label className="text-xs font-medium text-slate-600 block mb-1" htmlFor="onb-note">
          Note {copy.noteRequired
            ? <span className="text-slate-400">(required, min 10 chars)</span>
            : <span className="text-slate-400">(optional)</span>}
        </label>
        <textarea
          id="onb-note"
          value={note}
          onChange={e => setNote(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 resize-none"
          rows={3}
          placeholder={copy.notePlaceholder}
        />

        {decision === "REQUEST_CORRECTION" && (
          <div className="mt-3">
            <label className="text-xs font-medium text-slate-600 block mb-1" htmlFor="onb-items">
              Correction items <span className="text-slate-400">(optional, one per line)</span>
            </label>
            <textarea
              id="onb-items"
              value={items}
              onChange={e => setItems(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 resize-none"
              rows={3}
              placeholder={"W-9 signature missing\nPayout account not verified"}
            />
          </div>
        )}

        <div className="flex gap-2 mt-4 justify-end">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button
            variant={copy.variant}
            size="sm"
            disabled={loading || !canConfirm}
            onClick={() => onConfirm(
              note.trim(),
              items.split("\n").map(s => s.trim()).filter(Boolean),
            )}
          >
            {loading
              ? <span className="flex items-center gap-1"><span className="animate-spin h-3 w-3 border-2 border-white/30 border-t-white rounded-full" />Processing…</span>
              : copy.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AffiliateOnboardingReviewActions({
  affiliateId,
  status,
}: {
  affiliateId: string;
  status: string;
}) {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleConfirm(note: string, correctionItems: string[]) {
    if (!decision) return;
    setLoading(true);
    try {
      await api.post(`/api/admin/affiliates/${affiliateId}/onboarding/review`, {
        decision,
        ...(note ? { note } : {}),
        ...(correctionItems.length ? { correctionItems } : {}),
      });
      toast.success(
        decision === "APPROVE" ? "Onboarding approved"
        : decision === "REJECT" ? "Onboarding rejected"
        : "Correction requested",
      );
      setDecision(null);
      router.refresh();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Review action failed"));
    } finally {
      setLoading(false);
    }
  }

  const isApproved = status === "APPROVED";

  return (
    <>
      {decision && (
        <ReviewModal
          decision={decision}
          loading={loading}
          onClose={() => setDecision(null)}
          onConfirm={handleConfirm}
        />
      )}
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="secondary"
          data-testid={`onb-approve-${affiliateId}`}
          disabled={isApproved}
          onClick={() => setDecision("APPROVE")}>
          Approve
        </Button>
        <Button size="sm" variant="ghost"
          data-testid={`onb-correction-${affiliateId}`}
          onClick={() => setDecision("REQUEST_CORRECTION")}>
          Corrections
        </Button>
        <Button size="sm" variant="ghost"
          data-testid={`onb-reject-${affiliateId}`}
          className="text-al-danger hover:text-al-danger"
          onClick={() => setDecision("REJECT")}>
          Reject
        </Button>
      </div>
    </>
  );
}
