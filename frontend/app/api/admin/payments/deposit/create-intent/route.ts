// POST /api/admin/payments/deposit/create-intent
// Admin creates a Stripe payment intent for the Auction Access Deposit on behalf of a buyer.
// Amount is ALWAYS from lib/constants.ts. NEVER accept amount from client.
// Intent ID is stored on the Deposit record.

import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getStripe } from "@/lib/stripe";
import { DEPOSIT_AMOUNT_CENTS, DEPOSIT_AMOUNT_USD } from "@/lib/constants";
import { limitPaymentIntent } from "@/lib/security/rate-limit";
import {
  findExistingDepositObligation,
  blocksNewIntent,
} from "@/lib/services/payment/deposit-obligation";
import { logger } from "@/lib/logger";
import { findOpenRequest } from "@/lib/services/vehicle-request/open-request.service";

const schema = z.object({
  buyerId: z.string().min(1),
  reason:  z.string().min(1),
});

export async function POST(request: NextRequest) {
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN", "FINANCE_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);

  // Throttle intent creation per admin account; fails CLOSED on store outage.
  const rl = await limitPaymentIntent(`deposit:admin:${admin.adminId}`, { tokens: 30, window: "1 h" });
  if (!rl.ok) return adminError("RATE_LIMITED", rl.message, rl.status);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { buyerId, reason } = parsed.data;

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, include: { user: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  // MONEY-PATH DEFECT 4, fixed at the cause. This route used to mint an intent and
  // INSERT a fresh Deposit row unconditionally — no local check, no provider check.
  // An admin could hand a buyer who had already paid a second $99 obligation, and the
  // buyer route's own ALREADY_PAID rule had no counterpart here.
  //
  // §5d asks the PROVIDER, not our column: "a buyer is never charged twice because
  // local webhook state is stale". The shared check does that, and the same call
  // guards the buyer route and send-link, so the three cannot drift apart again.
  // REQUEST-SCOPED, exactly as the buyer route is.
  //
  // Found by the independent review: these two called the shared check with the buyer
  // alone. `OBLIGATION_BEARING` includes PAID, so for a repeat buyer whose FIRST request
  // was completed and paid, Stripe reports that old intent as succeeded, the check
  // returns SETTLED, and both admin routes answer ALREADY_PAID — permanently. An admin
  // could never issue or mail a $99 for any buyer's second request, while the buyer's
  // own route worked, because only that one passed the request. §23.1 is explicit that
  // "a new request means a new $99", and the shared check documents the scoping as
  // required; two of its three callers simply did not supply it.
  const openRequest = await findOpenRequest(buyerId);
  const obligation = await findExistingDepositObligation({
    buyerId,
    vehicleRequestId: openRequest?.id ?? null,
  });

  if (blocksNewIntent(obligation)) {
    if (obligation.kind === "SETTLED") {
      return adminError(
        "ALREADY_PAID",
        `This buyer has already paid the ${DEPOSIT_AMOUNT_USD} deposit (Stripe intent ` +
          `${obligation.paymentIntentId}, deposit ${obligation.deposit.id}). Creating a second intent ` +
          `would charge them twice.`,
        409,
      );
    }
    // Fail closed. Stripe could not confirm what is outstanding, and "we could not
    // check" is not evidence that nothing is owed.
    return adminError(
      "PROVIDER_UNREACHABLE",
      "Stripe could not be reached to confirm whether this buyer already has an outstanding or " +
        "settled deposit. Refusing to create a second intent. Try again shortly.",
      503,
    );
  }

  // A live intent already exists — hand back that one. Creating a parallel intent for
  // the same obligation is the double-charge this route is being fixed for.
  if (obligation.kind === "IN_FLIGHT") {
    return adminSuccess({
      depositId: obligation.deposit.id,
      amountCents: DEPOSIT_AMOUNT_CENTS,
      stripePaymentIntentId: obligation.paymentIntentId,
      status: obligation.deposit.status,
      reused: true,
    }, 200);
  }

  // Create Stripe payment intent — amount from constants.ts ONLY
  let intentId: string;
  try {
    const intent = await getStripe().paymentIntents.create({
      amount: DEPOSIT_AMOUNT_CENTS, // server-side constant from constants.ts
      currency: "usd",
      metadata: { buyerId, type: "deposit", source: "admin_initiated" },
      description: `AutoLenis ${DEPOSIT_AMOUNT_USD} Auction Access Deposit (admin-initiated)`,
    }, {
      // KEYED PER REQUEST, not per buyer.
      //
      // Found by the second independent review. Stripe holds an idempotency key for 24
      // hours, and this one named only the buyer — so once the obligation check became
      // request-scoped (correctly: §23.1 says a new request means a new $99), a second
      // mint inside that window replayed the FIRST request's intent. If that intent had
      // succeeded, the deposit insert collided on the unique PaymentIntent, the P2002
      // recovery returned the OLD request's PAID row, and the route reported a fresh
      // PENDING obligation that did not exist. The admin would believe a $99 was owed
      // for the new request when nothing had been created for it.
      //
      // The request scopes the key exactly as the obligation check scopes the question.
      // A buyer with no open request keeps the buyer-scoped key, which is the shape that
      // has always applied to a deposit with nothing to attach to.
      idempotencyKey: openRequest
        ? `deposit-admin-${buyerId}-${openRequest.id}`
        : `deposit-admin-${buyerId}`,
    });
    intentId = intent.id;
  } catch (err) {
    // The fabricated `pi_admin_<timestamp>` fallback that used to live here is gone,
    // and its removal matters more than it looks. That id was written into
    // Deposit.stripePaymentIntentId, where it became a permanent lie: the reconciler
    // would try to retrieve an intent Stripe never issued, and `refundDepositCharge`
    // reads the `pi_admin_` prefix as NO_CHARGE — so a row created during a Stripe
    // outage could never be refunded. The concierge-fee sibling already returns 503
    // here; this route now matches it.
    logger.error("[admin/deposit/create-intent] Stripe intent creation failed:", err);
    return adminError("STRIPE_ERROR", "Could not create the payment intent. Please try again.", 503);
  }

  // An UNVERIFIABLE row (no intent, or a synthetic id from the old fallback) is
  // attached to rather than duplicated — one obligation, one row. `updateMany` scoped
  // to a row that still has no real intent keeps this safe against a concurrent
  // writer; count 0 means someone else attached first, and we fall through to insert.
  let deposit: { id: string } | null = null;
  if (obligation.kind === "UNVERIFIABLE") {
    const claimed = await prisma.deposit.updateMany({
      where: { id: obligation.deposit.id, stripePaymentIntentId: obligation.deposit.stripePaymentIntentId },
      data: { stripePaymentIntentId: intentId, status: "PENDING" },
    });
    if (claimed.count === 1) deposit = { id: obligation.deposit.id };
  }

  // Create deposit record with PENDING status.
  // `stripePaymentIntentId` is @unique, and this route's idempotency key is stable per
  // buyer, so a repeat call inside Stripe's 24h window returns the SAME intent id. That
  // used to raise an unhandled P2002; it now resolves to the row that already carries it.
  if (!deposit) {
    try {
      deposit = await prisma.deposit.create({
        data: {
          buyerId,
          amountCents: DEPOSIT_AMOUNT_CENTS,
          status: "PENDING",
          stripePaymentIntentId: intentId,
        },
      });
    } catch (err) {
      if ((err as { code?: string } | null)?.code !== "P2002") throw err;
      const existing = await prisma.deposit.findFirst({ where: { stripePaymentIntentId: intentId } });
      if (!existing) throw err;
      deposit = existing;
    }
  }

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "DEPOSIT_INTENT_CREATED",
      entityType: "Deposit",
      entityId: deposit.id,
      reason,
      metadata: { buyerId, amountCents: DEPOSIT_AMOUNT_CENTS, intentId },
    },
  });

  // READ THE ROW BACK, never assert its shape. The response used to carry the literal
  // "PENDING", which is a claim about a row rather than a reading of one — and the P2002
  // recovery above can hand back a row that is already PAID (a replayed intent from a
  // prior request inside Stripe's 24-hour window). Reporting PENDING for it told the
  // admin an obligation existed that had in fact been settled.
  const created = await prisma.deposit.findUnique({
    where: { id: deposit.id },
    select: { amountCents: true, status: true, vehicleRequestId: true },
  });

  return adminSuccess({
    depositId: deposit.id,
    amountCents: created?.amountCents ?? DEPOSIT_AMOUNT_CENTS,
    stripePaymentIntentId: intentId,
    status: created?.status ?? "PENDING",
    vehicleRequestId: created?.vehicleRequestId ?? null,
  }, 201);
}
