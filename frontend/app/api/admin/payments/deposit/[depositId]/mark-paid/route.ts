// POST /api/admin/payments/deposit/[depositId]/mark-paid
//
// Admin manually records a deposit as PAID when the money arrived outside Stripe
// (wire, cash, a charge reconciled by hand) or when a real Stripe payment never
// reached the platform. An AdminAuditLog entry with an override reason is required.
//
// PARITY WITH THE WEBHOOK. Recording PAID is only half of what payment means
// here: the Stripe webhook's deposit branch flips PAID *and* creates the auction,
// launches it, and invites dealers. This route used to write PAID and stop, which
// left a paid buyer with no auction, no invitations, and no way forward — the
// buyer paid and the platform did nothing. It now hands off to the SAME canonical
// fulfillment the activation reconciler drives (reconcileDepositActivation), so
// there is exactly one implementation of the cascade and no second money path.
//
// TRUTHFULNESS. An admin override has NO provider evidence. This route therefore
// never writes a PaymentProviderEvent — inventing one would put a fabricated
// Stripe fact in the ledger. The override is recorded for what it is
// (`providerConfirmed: false` in the audit metadata), and the Program 1 health
// invariant independently surfaces PAID-without-provider-evidence deposits for
// reconciliation.

import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { allowedPredecessors } from "@/lib/payments/deposit-state";
import { reconcileDepositActivation } from "@/lib/services/auction/deposit-activation.service";
import { z } from "zod";

interface Props { params: Promise<{ depositId: string }> }

const schema = z.object({ reason: z.string().min(1) });

// Activation outcomes that mean the deposit now has a live auction behind it.
// Everything else (a lost idempotency race, a refused convergence, a no-dealer
// close) leaves the buyer without one and must not be reported as unblocked.
const UNBLOCKED_OUTCOMES = new Set(["ok", "invited", "awaiting_dealers"]);

export async function POST(request: NextRequest, { params }: Props) {
  const { depositId } = await params;
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN", "FINANCE_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);

  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit) return adminError("NOT_FOUND", "Deposit not found", 404);
  // Idempotency, first line: a deposit already PAID is not re-flipped, not
  // re-audited, and does not re-fire the cascade. (The guarded flip below is the
  // authoritative backstop for the concurrent case this read cannot see.)
  if (deposit.status === "PAID") return adminError("ALREADY_PAID", "Deposit is already marked PAID", 400);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.message, 400);

  const { reason } = parsed.data;

  // Status write through the transition matrix, enforced at the DB. The WHERE
  // clause constrains the predecessor set, so this can never resurrect a settled
  // REFUNDED/FAILED deposit and never double-applies under concurrency — the
  // check-then-write race a findUnique + unconditional update leaves open.
  const flipped = await prisma.deposit.updateMany({
    where: { id: depositId, status: { in: allowedPredecessors("PAID") } },
    data: { status: "PAID" },
  });
  if (flipped.count === 0) {
    // Either the deposit is in a terminal state PAID is unreachable from, or a
    // concurrent path settled it between the read above and this write. Nothing
    // was recorded, so nothing is audited and no fulfillment runs.
    return adminError(
      "INVALID_STATE",
      `Deposit cannot move to PAID from its current state (${deposit.status}).`,
      409,
    );
  }

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "DEPOSIT_MARK_PAID_OVERRIDE",
      entityType: "Deposit",
      entityId: depositId,
      reason,
      metadata: {
        buyerId: deposit.buyerId,
        amountCents: deposit.amountCents,
        override: true,
        // Distinguishes admin-origin PAID from provider-confirmed PAID. No
        // PaymentProviderEvent is written for an override — there is no Stripe
        // evidence to record, and a fabricated one would falsify the ledger.
        providerConfirmed: false,
        stripePaymentIntentId: deposit.stripePaymentIntentId ?? null,
        previousStatus: deposit.status,
      },
    },
  });

  // Canonical post-payment fulfillment — the same convergence the reconciler
  // cron drives for a deposit the webhook left stranded: create the auction,
  // launch it, invite dealers, or refuse and raise an operational exception
  // (concierge deposits, indeterminate track). It is idempotent and serialized
  // on a per-deposit guard, so running it twice, or the Stripe webhook arriving
  // for this same deposit afterwards, cannot double-launch or double-invite.
  //
  // Best-effort relative to the money fact: PAID has already committed, and a
  // fulfillment failure must not un-record it. The reconciler cron re-attempts
  // any deposit left unconverged.
  let fulfillment = "unavailable";
  try {
    fulfillment = await reconcileDepositActivation(depositId);
  } catch (err) {
    logger.error(`[deposit/mark-paid] fulfillment failed for deposit ${depositId} (deposit remains PAID):`, err);
  }

  return adminSuccess({
    depositId,
    status: "PAID",
    buyerId: deposit.buyerId,
    fulfillment,
    auctionUnblocked: UNBLOCKED_OUTCOMES.has(fulfillment),
  });
}
