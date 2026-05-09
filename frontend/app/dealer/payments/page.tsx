import { requireDealer } from "@/lib/auth/dealer-session";
import { getDealerBillingData } from "@/lib/services/dealer/dealer-billing.service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  CreditCard, AlertTriangle, CheckCircle2, Clock,
  FileText, ExternalLink, LifeBuoy, Plus,
} from "lucide-react";

export const dynamic = "force-dynamic";

function formatDollars(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

function shortId(id: string) {
  return id.slice(0, 8);
}

export default async function DealerPaymentsPage() {
  const dealer = await requireDealer();
  const billing = await getDealerBillingData(dealer.id);

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="dealer-payments-page">

      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <CreditCard size={22} className="text-[#0B5FD1]" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Billing &amp; Payments</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Invoices and fees owed to AutoLenis for platform services
          </p>
        </div>
      </div>

      {/* ── 6. Failed / past-due alert ──────────────────────────────────────── */}
      {billing.hasPastDue && (
        <div
          className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 mb-5"
          data-testid="past-due-alert"
        >
          <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-700 text-sm">Payment past due</p>
            <p className="text-xs text-red-500 mt-0.5">
              One or more invoices have not been paid. Please settle your balance to avoid
              suspension of auction participation.
            </p>
          </div>
        </div>
      )}

      {/* ── 1. Amount due ───────────────────────────────────────────────────── */}
      <div
        className="bg-white border border-slate-200 rounded-xl p-6 mb-5 flex items-center justify-between gap-4"
        data-testid="amount-due-section"
      >
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Total Amount Due to AutoLenis</p>
          <p
            className={`text-3xl font-bold ${billing.totalDueCents > 0 ? (billing.hasPastDue ? "text-red-600" : "text-slate-900") : "text-slate-400"}`}
            data-testid="total-due-amount"
          >
            {formatDollars(billing.totalDueCents)}
          </p>
          {billing.openInvoices.length > 0 && (
            <p className="text-xs text-slate-500 mt-1">
              {billing.openInvoices.length} open invoice{billing.openInvoices.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        {/* ── 5. Pay now CTA ─────────────────────────────────────────────────── */}
        {billing.totalDueCents > 0 ? (
          <Button
            data-testid="pay-now-btn"
            className="bg-[#0B5FD1] text-white hover:bg-[#4f2577] shrink-0"
            href="/dealer/payments/checkout"
          >
            Pay Now
          </Button>
        ) : (
          <div className="flex items-center gap-2 text-green-600 text-sm font-medium" data-testid="balance-clear">
            <CheckCircle2 size={16} />
            Balance clear
          </div>
        )}
      </div>

      {/* ── 4. Saved payment method ─────────────────────────────────────────── */}
      <div
        className="bg-white border border-slate-200 rounded-xl p-5 mb-5"
        data-testid="saved-payment-method-section"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CreditCard size={16} className="text-slate-400" />
            <div>
              <p className="text-sm font-semibold text-slate-900">Saved Payment Method</p>
              {billing.savedPaymentMethod === null ? (
                <p className="text-xs text-slate-400 mt-0.5">No payment method on file</p>
              ) : (
                <p className="text-xs text-slate-500 mt-0.5">Card on file</p>
              )}
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            href="/dealer/payments/payment-method"
            data-testid="add-payment-method-btn"
          >
            <Plus size={12} className="mr-1" />
            {billing.savedPaymentMethod === null ? "Add" : "Update"}
          </Button>
        </div>
      </div>

      {/* ── 2. Open invoices ────────────────────────────────────────────────── */}
      <div className="mb-5" data-testid="open-invoices-section">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Open Invoices</h2>
        {billing.openInvoices.length === 0 ? (
          <div
            className="bg-white border border-slate-200 rounded-xl px-5 py-8 text-center text-sm text-slate-400"
            data-testid="no-open-invoices"
          >
            <CheckCircle2 size={24} className="mx-auto mb-2 opacity-30" />
            No outstanding invoices
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden" data-testid="open-invoices-table">
            <div className="grid grid-cols-[1fr_auto_auto_auto] px-5 py-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-400 uppercase tracking-wide gap-3">
              <span>Invoice</span>
              <span>Date</span>
              <span>Status</span>
              <span className="text-right">Amount</span>
            </div>
            {billing.openInvoices.map((inv, i) => (
              <div
                key={inv.id}
                data-testid={`open-invoice-${inv.id}`}
                className={`grid grid-cols-[1fr_auto_auto_auto] items-center px-5 py-4 gap-3 text-sm ${
                  i < billing.openInvoices.length - 1 ? "border-b border-slate-100" : ""
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={13} className="text-slate-400 shrink-0" />
                  <span className="text-slate-700 text-sm truncate">{inv.description}</span>
                </div>
                <span className="text-slate-400 text-xs whitespace-nowrap">
                  {inv.invoiceDate.toLocaleDateString()}
                </span>
                <Badge
                  variant={inv.isPastDue ? "destructive" : "secondary"}
                  className="text-xs whitespace-nowrap"
                  data-testid={inv.isPastDue ? "past-due-badge" : "open-badge"}
                >
                  {inv.isPastDue ? "Past Due" : "Open"}
                </Badge>
                <div className="flex items-center gap-2 justify-end">
                  <span className={`font-semibold ${inv.isPastDue ? "text-red-600" : "text-slate-900"}`}>
                    {formatDollars(inv.amountCents)}
                  </span>
                  {/* ── 7. Invoice detail link ──────────────────────────── */}
                  <Link
                    href={inv.detailHref}
                    className="text-[#0B5FD1] hover:text-[#4f2577]"
                    data-testid={`invoice-detail-link-${inv.id}`}
                    aria-label="View deal detail"
                  >
                    <ExternalLink size={13} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 3. Payment history ──────────────────────────────────────────────── */}
      <div className="mb-5" data-testid="payment-history-section">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Payment History</h2>
        {billing.paymentHistory.length === 0 ? (
          <div
            className="bg-white border border-slate-200 rounded-xl px-5 py-8 text-center text-sm text-slate-400"
            data-testid="no-payment-history"
          >
            <Clock size={24} className="mx-auto mb-2 opacity-30" />
            No payment history yet
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden" data-testid="payment-history-table">
            <div className="grid grid-cols-[1fr_auto_auto] px-5 py-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-400 uppercase tracking-wide gap-3">
              <span>Reference</span>
              <span>Date Paid</span>
              <span className="text-right">Amount</span>
            </div>
            {billing.paymentHistory.map((record, i) => (
              <div
                key={record.id}
                data-testid={`payment-record-${record.id}`}
                className={`grid grid-cols-[1fr_auto_auto] items-center px-5 py-4 gap-3 text-sm ${
                  i < billing.paymentHistory.length - 1 ? "border-b border-slate-100" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={13} className="text-green-500 shrink-0" />
                  <span className="text-slate-600 text-xs font-mono truncate">
                    {record.stripePaymentIntentId ?? `deal-${shortId(record.dealId)}`}
                  </span>
                </div>
                <span className="text-slate-400 text-xs whitespace-nowrap">
                  {record.paidAt ? record.paidAt.toLocaleDateString() : "—"}
                </span>
                <span className="text-slate-900 font-semibold text-right">
                  {formatDollars(record.amountCents)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 8. Billing support link ─────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4"
        data-testid="billing-support-section"
      >
        <div className="flex items-center gap-3">
          <LifeBuoy size={16} className="text-slate-400" />
          <div>
            <p className="text-sm font-medium text-slate-800">Questions about your bill?</p>
            <p className="text-xs text-slate-400 mt-0.5">Our billing team is available Monday – Friday, 9am – 5pm ET</p>
          </div>
        </div>
        <Link
          href="/contact?subject=billing"
          className="text-sm text-[#0B5FD1] hover:underline whitespace-nowrap"
          data-testid="billing-support-link"
        >
          Contact billing support
        </Link>
      </div>

    </div>
  );
}
