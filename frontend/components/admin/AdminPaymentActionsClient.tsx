"use client";

import { toast } from "sonner";
import { useState } from "react";
import { X, AlertTriangle } from "lucide-react";
import { canUse, deniedReason } from "@/lib/auth/admin-ui-roles";
import { api } from "@/lib/api/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DepositActionProps {
  /** UX only — every mutating route below re-checks the role server-side. */
  adminRole?: string;
  type: "deposit";
  depositId: string;
  buyerId: string;
  buyerEmail: string;
  status: string; // PENDING | PAID | REFUNDED | WAIVED
}

export interface ConciergeFeeActionProps {
  /** UX only — every mutating route below re-checks the role server-side. */
  adminRole?: string;
  type: "concierge_fee";
  dealId: string;
  buyerId: string;
  buyerEmail: string;
  feeStatus: "PENDING" | "PAID" | "REFUNDED";
}

type Props = DepositActionProps | ConciergeFeeActionProps;

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PAID: "bg-green-100 text-green-700 border border-green-200",
    PENDING: "bg-amber-100 text-amber-700 border border-amber-200",
    REFUNDED: "bg-red-100 text-red-700 border border-red-200",
    WAIVED: "bg-slate-100 text-slate-600 border border-slate-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${map[status] ?? "bg-slate-100 text-slate-600 border border-slate-200"}`}>
      {status}
    </span>
  );
}

// ─── Action Modal ─────────────────────────────────────────────────────────────

interface ModalProps {
  title: string;
  warning: string;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

function ActionModal({ title, warning, onCancel, onConfirm }: ModalProps) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 10) { setError("Reason must be at least 10 characters"); return; }
    setLoading(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-md">
        <div className="flex items-start justify-between mb-4">
          <h3 className="font-bold text-lg text-slate-900">{title}</h3>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-600 ml-2">
            <X size={18} />
          </button>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 mb-4">
          {warning}
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Reason (required, min 10 characters)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe the reason for this action…"
              rows={3}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle size={12} />{error}
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onCancel}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading || reason.trim().length < 10}
              className="px-4 py-2 text-sm bg-al-primary text-white rounded-lg font-semibold hover:bg-[#52287a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? "Processing…" : "Confirm"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminPaymentActionsClient(props: Props) {
  // UX only. mark-paid, waive (deposit/override) and refund all hard-deny
  // outside ["SUPER_ADMIN","FINANCE_ADMIN"]; the send-link routes are auth-only
  // and stay open to every admin.
  const mayMutate = canUse("payments.mutate", props.adminRole);
  const denied = deniedReason("payments.mutate");
  const [modal, setModal] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(
    props.type === "deposit" ? props.status : props.feeStatus,
  );

  function showToast(msg: string, type: "success" | "error" = "success") {
    // sonner toast — global Toaster in app/layout.tsx
    if (type === "success") toast.success(msg);
    else toast.error(msg);
  }

  async function callApi(url: string, body: Record<string, unknown>): Promise<void> {
    await api.post(url, body);
  }

  // ── Deposit actions ──────────────────────────────────────────────────────

  if (props.type === "deposit") {
    const { depositId, buyerId, buyerEmail } = props;

    async function sendDepositLink(reason: string) {
      await api.post("/api/admin/payments/deposit/send-link", { buyerId, reason });
      showToast(`Payment link sent to ${buyerEmail}`);
    }

    async function markDepositPaid(reason: string) {
      await callApi(`/api/admin/payments/deposit/${depositId}/mark-paid`, { reason });
      setStatus("PAID");
      setModal(null);
      showToast("Deposit marked as paid");
    }

    async function waiveDeposit(reason: string) {
      await callApi(`/api/admin/buyers/${buyerId}/deposit/override`, { reason });
      setStatus("WAIVED");
      setModal(null);
      showToast("Deposit waived");
    }

    async function refundDeposit(reason: string) {
      await callApi(`/api/admin/payments/deposit/${depositId}/refund`, { reason });
      setStatus("REFUNDED");
      setModal(null);
      showToast("Deposit refunded");
    }

    return (
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge status={status} />

        {status === "PENDING" && (
          <>
            <button
              onClick={() => setModal("send-link")}
              className="px-3 py-1.5 text-xs bg-al-primary text-white rounded-lg font-semibold hover:bg-[#52287a] transition-colors"
            >
              Send $99 Payment Link
            </button>
            <button
              onClick={() => setModal("mark-paid")}
              disabled={!mayMutate}
              title={mayMutate ? undefined : denied}
              className="px-3 py-1.5 text-xs border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Mark as Paid
            </button>
            <button
              onClick={() => setModal("waive")}
              disabled={!mayMutate}
              title={mayMutate ? undefined : denied}
              className="px-3 py-1.5 text-xs border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Waive Deposit
            </button>
          </>
        )}

        {status === "PAID" && (
          <button
            onClick={() => setModal("refund")}
            disabled={!mayMutate}
            title={mayMutate ? undefined : denied}
            className="px-3 py-1.5 text-xs border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Refund Deposit
          </button>
        )}

        {/* Send-link modal uses inline confirmation since no reason needed */}
        {modal === "send-link" && (
          <ActionModal
            title="Send $99 Payment Link"
            warning="This will send a Stripe Checkout link to the buyer's email for the $99 Auction Access Deposit."
            onCancel={() => setModal(null)}
            onConfirm={async (reason) => { await sendDepositLink(reason); setModal(null); }}
          />
        )}

        {modal === "mark-paid" && (
          <ActionModal
            title="Mark $99 Deposit as Paid"
            warning="Use only for verified offline or cash payments. This bypasses Stripe."
            onCancel={() => setModal(null)}
            onConfirm={markDepositPaid}
          />
        )}

        {modal === "waive" && (
          <ActionModal
            title="Waive $99 Deposit"
            warning="This removes the deposit requirement for this buyer."
            onCancel={() => setModal(null)}
            onConfirm={waiveDeposit}
          />
        )}

        {modal === "refund" && (
          <ActionModal
            title="Refund $99 Deposit"
            warning="This will refund $99 to the buyer's original payment method via Stripe and cancel the associated auction."
            onCancel={() => setModal(null)}
            onConfirm={refundDeposit}
          />
        )}
      </div>
    );
  }

  // ── Concierge fee actions ────────────────────────────────────────────────

  const { dealId, buyerEmail } = props;

  async function sendFeeLink(reason: string) {
    await api.post("/api/admin/payments/concierge-fee/send-link", { dealId, reason });
    showToast(`Payment link sent to ${buyerEmail}`);
  }

  async function markFeePaid(reason: string) {
    await callApi(`/api/admin/payments/concierge-fee/${dealId}/mark-paid`, { reason });
    setStatus("PAID");
    setModal(null);
    showToast("Concierge fee marked as paid");
  }

  async function refundFee(reason: string) {
    await callApi(`/api/admin/payments/concierge-fee/${dealId}/refund`, { reason });
    setStatus("REFUNDED");
    setModal(null);
    showToast("Concierge fee refunded");
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <StatusBadge status={status} />

      {status === "PENDING" && (
        <>
          <button
            onClick={() => setModal("send-link")}
            className="px-3 py-1.5 text-xs bg-al-primary text-white rounded-lg font-semibold hover:bg-[#52287a] transition-colors"
          >
            Send $400 Payment Link
          </button>
          <button
            onClick={() => setModal("mark-paid")}
            disabled={!mayMutate}
            title={mayMutate ? undefined : denied}
            className="px-3 py-1.5 text-xs border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Mark as Paid
          </button>
        </>
      )}

      {status === "PAID" && (
        <button
          onClick={() => setModal("refund")}
          className="px-3 py-1.5 text-xs border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors"
        >
          Refund Fee
        </button>
      )}

      {modal === "send-link" && (
        <ActionModal
          title="Send $400 Payment Link"
          warning="This will send a Stripe Checkout link to the buyer's email for the $499 Concierge Fee ($99 deposit credited — $400 due)."
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await sendFeeLink(reason); setModal(null); }}
        />
      )}

      {modal === "mark-paid" && (
        <ActionModal
          title="Mark $499 Fee as Paid ($400 due)"
          warning="Use only for verified offline or cash payments."
          onCancel={() => setModal(null)}
          onConfirm={markFeePaid}
        />
      )}

      {modal === "refund" && (
        <ActionModal
          title="Refund $499 Concierge Fee"
          warning="This will refund the concierge fee to the buyer's original payment method via Stripe."
          onCancel={() => setModal(null)}
          onConfirm={refundFee}
        />
      )}
    </div>
  );
}
