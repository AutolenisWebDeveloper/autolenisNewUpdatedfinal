"use client";

// Decision 3 — the Finance Hub's payout request control (replaces the
// "Payouts opening soon" placeholder and the orphaned PayoutRequestButton).
// Irreversible-ish money action: kit ConfirmDialog with the exact amount and
// consequence copy; disabled-while-submitting; typed errors surfaced
// verbatim; success refreshes the server-rendered page state.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Clock } from "lucide-react";
import { ConfirmDialog } from "@/components/admin/crm/ui/ConfirmDialog";

interface Props {
  availableCents: number;
  minimumCents: number;
  /** Unmet prerequisites, in user words (e.g. "add a payout method"). */
  missing: string[];
  pendingRequest: { amountCents: number; requestedAt: string } | null;
}

export default function PayoutRequestSection({ availableCents, minimumCents, missing, pendingRequest }: Props) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);

  const dollars = (cents: number) =>
    `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (pendingRequest || requested) {
    const amount = pendingRequest ? dollars(pendingRequest.amountCents) : dollars(availableCents);
    return (
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3" data-testid="payout-request-pending">
        <Clock size={15} className="text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-amber-900">Payout request pending — {amount}</p>
          <p className="text-xs text-amber-800 mt-0.5">
            Our team reviews and pays requests manually. You&apos;ll get a notification when it&apos;s processed;
            new earnings keep accruing toward your next request.
          </p>
        </div>
      </div>
    );
  }

  const belowMinimum = availableCents < minimumCents;
  const blocked = missing.length > 0 || belowMinimum || availableCents === 0;

  async function submitRequest() {
    setError(null);
    const res = await fetch("/api/affiliate/payouts/request", { method: "POST" });
    const data = (await res.json().catch(() => null)) as
      | { success?: boolean; error?: { code?: string; message?: string } }
      | null;
    if (!res.ok || !data?.success) {
      const message = data?.error?.message ?? `Request failed (${res.status}). Please try again.`;
      setError(message);
      throw new Error(message); // keeps the dialog open in its error state
    }
    setRequested(true);
    router.refresh();
  }

  return (
    <div data-testid="payout-request-section">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-sm text-slate-700">
            Available for payout: <strong className="text-slate-900">{dollars(availableCents)}</strong>
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {blocked
              ? belowMinimum && missing.length === 0
                ? `Payouts start at ${dollars(minimumCents)} — keep earning to unlock your first request.`
                : `To request a payout: ${missing.join(", ")}${belowMinimum ? `, reach ${dollars(minimumCents)} approved` : ""}.`
              : "Requests are reviewed and paid manually by AutoLenis, typically within a few business days."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={blocked}
          data-testid="request-payout-button"
          className="inline-flex items-center justify-center gap-2 bg-al-primary text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-al-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          <Send size={14} aria-hidden="true" />
          Request Payout
        </button>
      </div>
      {error && (
        <p className="text-sm text-red-600 mt-2" role="alert" data-testid="payout-request-error">{error}</p>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Request a ${dollars(availableCents)} payout?`}
        description={
          <>
            This claims all of your currently approved commissions ({dollars(availableCents)}) into one
            payout request. You can&apos;t make another request until this one is settled, and the claimed
            commissions are locked to it. Payment goes to your saved payout method and is processed
            manually by our team.
          </>
        }
        confirmLabel="Request payout"
        variant="danger"
        onConfirm={submitRequest}
        data-testid="payout-request-confirm"
      />
    </div>
  );
}
