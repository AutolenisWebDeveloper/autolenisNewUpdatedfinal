"use client";

// S7-24 — the dealership's "no", as a control that actually stops the reminders.
//
// WHY THIS IS A CLIENT COMPONENT AND NOT A FORM POST. `POST /api/dealer/auctions/[id]/decline`
// answers with JSON, so a plain `<form method="post">` would navigate the browser to a page of
// raw JSON — the decline would have worked and the dealership would be looking at
// `{"success":true,...}` with no way back. It goes through the shared `api` client for the same
// reason every other portal control does: one place that attaches credentials, parses the
// envelope, and turns a failure into a sentence.
//
// IT CONFIRMS FIRST. Declining cancels the 50% and 90% reminders and takes the rooftop out of
// the field for this auction; it is not destructive, but it is not undoable from the UI either
// (reopening is an Operations action while the auction is live). A one-click "Not this one" next
// to "Submit your offer" is a misclick with a consequence, so the second click is the answer.
//
// "ALREADY DECLINED" IS A SUCCESS, NOT AN ERROR. The route is idempotent and says so; a
// dealership that clicks twice has done nothing wrong and must not be shown a failure.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, XCircle } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";

export default function DeclineInvitationButton({ auctionId }: { auctionId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  async function decline() {
    setLoading(true);
    setError(null);
    try {
      await api.post(`/api/dealer/auctions/${auctionId}/decline`, {});
      setDeclined(true);
      router.refresh();
    } catch (err) {
      // The server's own reason, which for the one real refusal is specific and actionable:
      // an offer already stands and withdrawing it is a support action, not this button.
      setError(apiErrorMessage(err, "We could not record that just now. Try again."));
    } finally {
      setLoading(false);
    }
  }

  if (declined) {
    return (
      <p className="text-sm font-medium text-slate-600" data-testid="invitation-declined-confirmation">
        Thanks — we won&apos;t remind you about this one again.
      </p>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        data-testid="invitation-decline"
        className="h-11 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
      >
        Not this one
      </button>
    );
  }

  return (
    <div className="w-full" data-testid="invitation-decline-confirm">
      <p className="text-sm text-slate-600">
        Pass on this auction? We will stop the reminders for it and you will be invited to the next
        request that matches your inventory.
      </p>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert" data-testid="invitation-decline-error">
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={decline}
          disabled={loading}
          data-testid="invitation-decline-confirm-btn"
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
        >
          {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />}
          {loading ? "Recording…" : "Yes, pass on it"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={loading}
          className="text-sm text-slate-500 transition-colors hover:text-slate-800"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
