import { requireDealer } from "@/lib/auth/dealer-session";
import { getDealerBillingData } from "@/lib/services/dealer/dealer-billing.service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageContainer, PageHeader, CARD, FIGURE } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  CreditCard, AlertTriangle, CheckCircle2, Clock,
  FileText, ExternalLink, LifeBuoy,
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
    <PageContainer testId="dealer-payments-page">
      <PageHeader
        title="Billing & Payments"
        subtitle="Invoices and fees owed to AutoLenis for platform services."
      />

      {/* ── 6. Failed / past-due alert ──────────────────────────────────────── */}
      {billing.hasPastDue && (
        <div
          className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-2xl p-4 mb-5"
          data-testid="past-due-alert"
        >
          <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-700 text-sm">Payment past due</p>
            <p className="text-xs text-red-600 mt-0.5">
              One or more invoices have not been paid. Please settle your balance to avoid
              suspension of auction participation.
            </p>
          </div>
        </div>
      )}

      {/* ── 1. Amount due ───────────────────────────────────────────────────── */}
      <div
        className={cn(CARD, "p-6 mb-5 flex items-center justify-between gap-4")}
        data-testid="amount-due-section"
      >
        <div>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.14em] mb-1">Total Amount Due to AutoLenis</p>
          <p
            className={cn("text-3xl", FIGURE, billing.totalDueCents > 0 ? (billing.hasPastDue ? "!text-red-600" : "") : "!text-slate-400")}
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

        {/* ── 5. Settle-balance CTA ──────────────────────────────────────────── */}
        {/* Online self-service payment is not launched yet — there is no dealer
            Stripe checkout. Rather than a dead "Pay Now" link to a page that does
            not exist, direct dealers to the billing team to settle. */}
        {billing.totalDueCents > 0 ? (
          <Button
            data-testid="pay-now-btn"
            variant="secondary"
            className="shrink-0"
            href="/contact?subject=billing"
          >
            Contact billing to pay
          </Button>
        ) : (
          <div className="flex items-center gap-2 text-emerald-600 text-sm font-medium" data-testid="balance-clear">
            <CheckCircle2 size={16} />
            Balance clear
          </div>
        )}
      </div>

      {/* ── 4. Saved payment method ─────────────────────────────────────────── */}
      <div
        className={cn(CARD, "p-5 mb-5")}
        data-testid="saved-payment-method-section"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CreditCard size={16} className="text-slate-400" />
            <div>
              <p className="text-sm font-semibold text-slate-900">Saved Payment Method</p>
              {billing.savedPaymentMethod === null ? (
                <p className="text-xs text-slate-500 mt-0.5">No payment method on file</p>
              ) : (
                <p className="text-xs text-slate-500 mt-0.5">Card on file</p>
              )}
            </div>
          </div>
          {/* Storing a card / self-service online payment is not available yet —
              show an honest status instead of a button linking to a page that
              does not exist. */}
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500"
            data-testid="payment-method-coming-soon"
          >
            <Clock size={11} aria-hidden="true" />
            Coming soon
          </span>
        </div>
      </div>

      {/* ── 2. Open invoices ────────────────────────────────────────────────── */}
      <div className="mb-5" data-testid="open-invoices-section">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Open Invoices</h2>
        {billing.openInvoices.length === 0 ? (
          <div
            className={cn(CARD, "px-5 py-8 text-center text-sm text-slate-500")}
            data-testid="no-open-invoices"
          >
            <CheckCircle2 size={24} className="mx-auto mb-2 text-slate-300" />
            No outstanding invoices
          </div>
        ) : (
          <div className={cn(CARD, "overflow-x-auto")} data-testid="open-invoices-table">
            <div className="min-w-[520px]">
              <div className="grid grid-cols-[1fr_auto_auto_auto] px-5 py-3 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-400 uppercase tracking-[0.14em] gap-3">
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
                  <span className="text-slate-500 text-xs whitespace-nowrap tabular-nums">
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
                    <span className={cn("font-mono tabular-nums font-semibold", inv.isPastDue ? "text-red-600" : "text-slate-900")}>
                      {formatDollars(inv.amountCents)}
                    </span>
                    {/* ── 7. Invoice detail link ──────────────────────────── */}
                    <Link
                      href={inv.detailHref}
                      className="text-al-primary hover:text-al-primary-hover"
                      data-testid={`invoice-detail-link-${inv.id}`}
                      aria-label="View deal detail"
                    >
                      <ExternalLink size={13} />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── 3. Payment history ──────────────────────────────────────────────── */}
      <div className="mb-5" data-testid="payment-history-section">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Payment History</h2>
        {billing.paymentHistory.length === 0 ? (
          <div
            className={cn(CARD, "px-5 py-8 text-center text-sm text-slate-500")}
            data-testid="no-payment-history"
          >
            <Clock size={24} className="mx-auto mb-2 text-slate-300" />
            No payment history yet
          </div>
        ) : (
          <div className={cn(CARD, "overflow-x-auto")} data-testid="payment-history-table">
            <div className="min-w-[480px]">
              <div className="grid grid-cols-[1fr_auto_auto] px-5 py-3 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-400 uppercase tracking-[0.14em] gap-3">
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
                    <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                    <span className="text-slate-600 text-xs font-mono truncate">
                      {record.stripePaymentIntentId ?? `deal-${shortId(record.dealId)}`}
                    </span>
                  </div>
                  <span className="text-slate-500 text-xs whitespace-nowrap tabular-nums">
                    {record.paidAt ? record.paidAt.toLocaleDateString() : "—"}
                  </span>
                  <span className="text-slate-900 font-mono tabular-nums font-semibold text-right">
                    {formatDollars(record.amountCents)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── 8. Billing support link ─────────────────────────────────────────── */}
      <div
        className={cn(CARD, "flex items-center justify-between px-5 py-4")}
        data-testid="billing-support-section"
      >
        <div className="flex items-center gap-3">
          <LifeBuoy size={16} className="text-slate-400" />
          <div>
            <p className="text-sm font-medium text-slate-800">Questions about your bill?</p>
            <p className="text-xs text-slate-500 mt-0.5">Our billing team is available Monday – Friday, 9am – 5pm ET</p>
          </div>
        </div>
        <Link
          href="/contact?subject=billing"
          className="text-sm text-al-primary hover:underline whitespace-nowrap"
          data-testid="billing-support-link"
        >
          Contact billing support
        </Link>
      </div>
    </PageContainer>
  );
}
