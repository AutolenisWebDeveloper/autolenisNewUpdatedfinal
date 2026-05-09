// lib/services/dealer/dealer-billing.service.ts
//
// Aggregates all billing data a dealer sees on /dealer/payments.
// Purpose: dealers owe AutoLenis platform/service fees per completed deal.
//
// Data sources:
//   • Deal.feeAmountCents / Deal.feePaidAt  — per-deal platform fee ledger
//   • ServiceFeePayment                    — Stripe payment record once a fee is collected
//
// "Open invoices" = deals with an outstanding fee (feeAmountCents set, feePaidAt null).
// "Payment history" = ServiceFeePayment records for this dealer's deals.
// "Past due" = open fee is on a COMPLETED or SIGNED deal older than 7 days.

import { prisma } from "@/lib/prisma";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DealerBillingInvoice {
  /** AutoLenis internal reference — the deal ID. */
  id: string;
  /** Human-readable label, e.g. "Platform fee – deal #abc123ef" */
  description: string;
  amountCents: number;
  /** Whether the fee is overdue (deal reached a terminal stage but fee is unpaid >7d). */
  isPastDue: boolean;
  /** The deal's creation date used as the invoice date. */
  invoiceDate: Date;
  /** Link to the dealer deal detail page for context. */
  detailHref: string;
}

export interface DealerBillingPaymentRecord {
  id: string;
  amountCents: number;
  /** Stripe Payment Intent ID if available. */
  stripePaymentIntentId: string | null;
  paidAt: Date | null;
  createdAt: Date;
  /** Originating deal ID. */
  dealId: string;
}

export interface DealerBillingData {
  /** Total of all unpaid fees currently owed to AutoLenis. */
  totalDueCents: number;
  /** True if any open invoice is past due. */
  hasPastDue: boolean;
  /** Open (unpaid) invoices. */
  openInvoices: DealerBillingInvoice[];
  /** Historical payments (fees already collected). */
  paymentHistory: DealerBillingPaymentRecord[];
  /**
   * Saved payment method stub.
   * The schema has no stored payment method model for dealers yet.
   * Returns null — the UI should show an "add payment method" prompt.
   */
  savedPaymentMethod: null;
}

// ── Service ──────────────────────────────────────────────────────────────────

const PAST_DUE_DAYS = 7;

export async function getDealerBillingData(dealerId: string): Promise<DealerBillingData> {
  const pastDueCutoff = new Date(Date.now() - PAST_DUE_DAYS * 24 * 60 * 60 * 1000);

  // Terminal deal statuses that trigger past-due for an unpaid fee
  const TERMINAL_STATUSES = [
    "SIGNED",
    "PICKUP_SCHEDULED",
    "PICKUP_COMPLETE",
    "COMPLETED",
  ] as const;

  // 1. Open invoices: deals with a fee amount set but not yet paid
  const dealsWithOpenFees = await prisma.deal.findMany({
    where: {
      offer: { dealerId },
      feeAmountCents: { not: null },
      feePaidAt: null,
    },
    select: {
      id: true,
      status: true,
      feeAmountCents: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const openInvoices: DealerBillingInvoice[] = dealsWithOpenFees.map(deal => {
    const isPastDue =
      (TERMINAL_STATUSES as readonly string[]).includes(deal.status) &&
      deal.createdAt < pastDueCutoff;

    return {
      id: deal.id,
      description: `Platform fee – deal #${deal.id.slice(0, 8)}`,
      amountCents: deal.feeAmountCents ?? 0,
      isPastDue,
      invoiceDate: deal.createdAt,
      detailHref: `/dealer/deals/${deal.id}`,
    };
  });

  const totalDueCents = openInvoices.reduce((sum, inv) => sum + inv.amountCents, 0);
  const hasPastDue = openInvoices.some(inv => inv.isPastDue);

  // 2. Payment history: ServiceFeePayment records for this dealer's deals.
  // ServiceFeePayment has no Prisma @relation to Deal, so we resolve deal IDs first.
  // Limit to the 100 most-recent deals to keep the IN clause manageable.
  const dealIds = await prisma.deal.findMany({
    where: { offer: { dealerId } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  }).then(rows => rows.map(r => r.id));

  const serviceFeePayments = dealIds.length > 0
    ? await prisma.serviceFeePayment.findMany({
        where: { dealId: { in: dealIds } },
        select: {
          id: true,
          netAmountCents: true,
          stripePaymentIntentId: true,
          paidAt: true,
          createdAt: true,
          dealId: true,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];

  const paymentHistory: DealerBillingPaymentRecord[] = serviceFeePayments.map(sfp => ({
    id: sfp.id,
    amountCents: sfp.netAmountCents,
    stripePaymentIntentId: sfp.stripePaymentIntentId,
    paidAt: sfp.paidAt,
    createdAt: sfp.createdAt,
    dealId: sfp.dealId,
  }));

  return {
    totalDueCents,
    hasPastDue,
    openInvoices,
    paymentHistory,
    savedPaymentMethod: null,
  };
}
