import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { DealStatus } from "@prisma/client";
import { refundDepositCharge } from "@/lib/services/payment/refund.service";
import {
  advanceDealStatus,
  cancelDeal,
  DealTransitionError,
  InsuranceRequiredError,
} from "@/lib/services/deal/deal.service";
import {
  sendDealerContractPendingEmail,
  sendDealerContractIssuesEmail,
  sendDealCompleteEmail,
} from "@/lib/services/email/resend.service";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

async function getDealerEmailForDeal(dealId: string) {
  const d = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      offer: { include: { dealer: { include: { user: { select: { email: true } } } } } },
    },
  });
  return d?.offer?.dealer
    ? {
        id: d.offer.dealer.id,
        email: d.offer.dealer.user?.email ?? null,
        dealershipName: d.offer.dealer.dealershipName,
      }
    : null;
}

interface Props { params: Promise<{ dealId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "Insufficient permissions — OPERATIONS_ADMIN or SUPER_ADMIN required", 403);
  }

  const { action, reason, newStatus, force } = await request.json() as {
    action: string;
    reason: string;
    newStatus?: string;
    force?: boolean;
  };

  if (!reason?.trim()) {
    return adminError("REASON_REQUIRED", "A reason is required for all admin actions", 400);
  }

  const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: { buyer: true } });
  if (!deal) return adminError("NOT_FOUND", "Deal not found", 404);

  let result: Record<string, unknown> = {};

  switch (action) {
    case "DEAL_STAGE_ADVANCED": {
      if (!newStatus || !Object.values(DealStatus).includes(newStatus as DealStatus)) {
        return adminError("INVALID_STATUS", "Invalid target status", 400);
      }
      // Route through the guarded state machine so illegal jumps (e.g. skipping
      // fee/insurance/contract gates) are rejected. An explicit `force: true`
      // performs an audit-logged override for legitimate manual corrections.
      try {
        await advanceDealStatus(dealId, newStatus as DealStatus, {
          actorId: admin.adminId,
          actorRole: "ADMIN",
          reason,
          force: force === true,
        });
      } catch (err) {
        if (err instanceof DealTransitionError) {
          return adminError(
            "INVALID_TRANSITION",
            `Cannot move deal from ${deal.status} to ${newStatus}. Pass force:true to override.`,
            409,
          );
        }
        if (err instanceof InsuranceRequiredError) {
          return adminError("INSURANCE_REQUIRED", err.message + ". Pass force:true to override.", 409);
        }
        throw err;
      }

      // Notify dealer when the deal enters a contract-pending state — non-blocking.
      if (newStatus === "CONTRACT_PENDING" || newStatus === "CONTRACT_REVIEW") {
        const dealerInfo = await getDealerEmailForDeal(dealId);
        if (dealerInfo?.email) {
          await sendDealerContractPendingEmail({
            to: dealerInfo.email,
            contactName: dealerInfo.dealershipName,
            dealId,
            vehicleRef: `Deal ${dealId.slice(0, 8)}`,
            uploadUrl: `${APP_URL}/dealer/deals/${dealId}`,
          }).catch(err => logger.error("[deals/action] contract pending email failed:", err));
        }
      }

      // Notify both parties when the deal completes — buyer (in-app + email), dealer (in-app).
      if (newStatus === "COMPLETED") {
        const buyer = await prisma.buyer.findUnique({
          where: { id: deal.buyerId },
          select: { firstName: true, user: { select: { email: true } } },
        });
        await prisma.notification.create({
          data: {
            buyerId: deal.buyerId,
            type: "DEAL_STAGE_CHANGED",
            title: "Your deal is complete",
            body: "Congratulations — your purchase is complete. Thank you for choosing AutoLenis.",
          },
        }).catch(err => logger.error("[deals/action] complete buyer notify failed:", err));
        if (buyer?.user?.email) {
          await sendDealCompleteEmail(buyer.user.email, buyer.firstName ?? "there", dealId)
            .catch(err => logger.error("[deals/action] deal complete email failed:", err));
        }
        const dealerInfo = await getDealerEmailForDeal(dealId);
        if (dealerInfo?.id) {
          await prisma.notification.create({
            data: {
              dealerId: dealerInfo.id,
              type: "DEAL_STAGE_CHANGED",
              channel: "IN_APP",
              title: "Deal completed",
              body: `Deal ${dealId.slice(0, 8)} has been marked complete.`,
            },
          }).catch(err => logger.error("[deals/action] complete dealer notify failed:", err));
        }
      }

      result = { newStatus };
      break;
    }

    case "CONTRACT_SHIELD_OVERRIDDEN": {
      // Admin can override a failing contract shield scan — requires reason
      await prisma.contractScan.create({
        data: {
          dealId,
          score: 100,
          status: "PASS",
          fixList: [],
          version: 999, // Admin override version
        },
      });
      await prisma.deal.update({ where: { id: dealId }, data: { contractShieldStatus: "PASS", contractShieldScore: 100 } });

      // Notify dealer of contract issues that were overridden — non-blocking.
      const dealerInfo = await getDealerEmailForDeal(dealId);
      if (dealerInfo?.email) {
        await sendDealerContractIssuesEmail({
          to: dealerInfo.email,
          contactName: dealerInfo.dealershipName,
          vehicleRef: `Deal ${dealId.slice(0, 8)}`,
          fixItems: [reason],
          contractUrl: `${APP_URL}/dealer/deals/${dealId}`,
          dealId,
        }).catch(err => logger.error("[deals/action] contract issues email failed:", err));
      }

      result = { overridden: true };
      break;
    }

    case "DEAL_CANCELLED": {
      if (["CANCELLED", "REFUNDED", "COMPLETED"].includes(deal.status)) {
        return adminError("INVALID_STATE", `Deal is already ${deal.status.toLowerCase()}`, 400);
      }

      // MONEY-PATH DEFECT 3. This branch used to refund the buyer's deposit as a
      // side effect of cancelling. §22.1 is explicit that it must not:
      //
      //   "Cancellation and refund are separate decisions. Cancelling a transaction
      //    does not entitle a refund, and issuing a refund does not erase the
      //    transaction record."
      //
      //   "Refunds are reviewed manually. There is no automatic refund."
      //
      // An automatic refund on cancel is both of those rules broken at once, and it
      // moved real money on an action an administrator took for a different purpose.
      // Cancelling now cancels. A refund is REFUND_TRIGGERED, reviewed on its own.
      //
      // Routed through `cancelDeal` rather than calling `advanceDealStatus` directly:
      // that is the ONE terminal cancellation path, it never refunds, and its
      // `expectedFrom` pin is what stops a cancel racing a concurrent completion and
      // silently undoing a finished purchase. Calling the underlying advance here was
      // how this route came to have its own cancellation semantics in the first place.
      const cancelled = await cancelDeal(dealId, reason, {
        actorId: admin.adminId,
        actorRole: "ADMIN",
      });
      if (!cancelled) {
        return adminError(
          "INVALID_STATE",
          "The deal changed state while this cancellation was being applied and was not cancelled. " +
            "Reload and check its current status before retrying.",
          409,
        );
      }
      const refunded = false;

      // Notify buyer.
      await prisma.notification.create({
        data: {
          buyerId: deal.buyerId,
          type: "DEAL_STAGE_CHANGED",
          title: "Deal cancelled",
          body: refunded
            ? "Your deal was cancelled and your deposit refunded. Please allow 3–5 business days for funds to appear."
            : "Your deal was cancelled. If a refund is due, our team will follow up shortly.",
        },
      }).catch(err => logger.error("[deals/action] cancel buyer notify failed:", err));

      // Notify dealer (in-app).
      const dealerInfo = await getDealerEmailForDeal(dealId);
      if (dealerInfo?.id) {
        await prisma.notification.create({
          data: {
            dealerId: dealerInfo.id,
            type: "DEAL_STAGE_CHANGED",
            channel: "IN_APP",
            title: "Deal cancelled",
            body: `Deal ${dealId.slice(0, 8)} was cancelled by the platform.`,
          },
        }).catch(err => logger.error("[deals/action] cancel dealer notify failed:", err));
      }

      result = { cancelled: true, refunded };
      break;
    }

    case "REFUND_TRIGGERED": {
      // Find the deposit and refund its real charge. FS-K: a no-real-charge /
      // admin-seeded deposit returns NO_CHARGE — no money moves — so we must NOT
      // tell the buyer "your refund has been processed". The deal is still moved
      // to REFUNDED (an admin bookkeeping transition), but the buyer notification
      // and the API `refunded` flag are gated on money actually having moved.
      const deposit = await prisma.deposit.findFirst({
        where: { buyerId: deal.buyerId, status: "PAID" },
        orderBy: { createdAt: "desc" },
      });

      // MONEY-PATH DEFECT 3. The advance used to sit outside this guard, with a
      // comment calling it "an admin bookkeeping transition" — so a deal reached
      // REFUNDED when the primitive had returned NO_CHARGE and no money had moved.
      // The buyer notification was already gated on the real outcome, which made the
      // deal record and the message the buyer received disagree with each other.
      //
      // §22.1: a no-charge record is never labelled as money refunded. REFUNDED is a
      // claim about money, so it is written only when money actually went back.
      let outcome: Awaited<ReturnType<typeof refundDepositCharge>>["outcome"] = "NO_CHARGE";
      if (deposit) {
        try {
          ({ outcome } = await refundDepositCharge(deposit, reason));
        } catch (err) {
          return adminError("STRIPE_ERROR", `Refund failed: ${err}`, 500);
        }
      }
      const refunded = outcome === "REFUNDED";

      if (!refunded) {
        // Nothing moved, so nothing is recorded as having moved. The message names
        // which of the three reasons applies, because they need different follow-ups:
        // reconcile out of band, look at the provider, or nothing to do.
        const why =
          !deposit
            ? "this buyer has no settled deposit"
            : outcome === "NO_CHARGE"
              ? "the deposit carries no captured Stripe charge (admin-seeded or comped) and must be reconciled out of band"
              : outcome === "NOT_SUCCEEDED"
                ? "Stripe reports the PaymentIntent never succeeded, so there is no captured money to return"
                : "a concurrent action already refunded it";
        return adminError(
          "NO_REFUND_PERFORMED",
          `No money was returned: ${why}. The deal has NOT been marked refunded — §22.1 does not permit ` +
            `recording a refund that did not happen.`,
          409,
        );
      }

      await advanceDealStatus(dealId, "REFUNDED", { actorId: admin.adminId, actorRole: "ADMIN", reason, force: true });

      // Notify buyer only when a real refund actually happened.
      await prisma.notification.create({
        data: {
          buyerId: deal.buyerId,
          title: refunded ? "Refund issued" : "Deal refunded",
          body: refunded
            ? "Your refund has been processed. Please allow 3–5 business days for funds to appear."
            : "Your deal was marked refunded. If a refund is due, our team will follow up shortly.",
          type: "DEAL_STAGE_CHANGED",
        },
      }).catch(err => logger.error("[deals/action] refund buyer notify failed:", err));

      result = { refunded };
      break;
    }

    default:
      return adminError("UNKNOWN_ACTION", "Unknown action", 400);
  }

  // Log to AdminAuditLog — every action recorded with actor, timestamp, reason
  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action,
      entityType: "Deal",
      entityId: dealId,
      reason,
      metadata: JSON.parse(JSON.stringify(result)),
    },
  });

  return adminSuccess(result);
}
