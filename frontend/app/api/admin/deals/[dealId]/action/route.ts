import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { DealStatus } from "@prisma/client";
import { getStripe } from "@/lib/stripe";
import {
  sendDealerContractPendingEmail,
  sendDealerContractIssuesEmail,
} from "@/lib/services/email/resend.service";

interface Props { params: Promise<{ dealId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "Insufficient permissions — OPERATIONS_ADMIN or SUPER_ADMIN required", 403);
  }

  const { action, reason, newStatus } = await request.json() as {
    action: string;
    reason: string;
    newStatus?: string;
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
      await prisma.deal.update({ where: { id: dealId }, data: { status: newStatus as DealStatus } });
      result = { newStatus };

      // Notify the dealer when a deal enters the contract-pending phase.
      if (newStatus === "CONTRACT_PENDING" || newStatus === "CONTRACT_REVIEW") {
        try {
          const dealWithDealer = await prisma.deal.findUnique({
            where: { id: dealId },
            include: {
              offer: {
                include: { dealer: { include: { user: { select: { email: true } } } } },
              },
            },
          });
          const dealer = dealWithDealer?.offer?.dealer;
          if (dealer?.user?.email) {
            await sendDealerContractPendingEmail({
              to: dealer.user.email,
              contactName: dealer.dealershipName,
              dealId,
              vehicleRef: `Deal ${dealId.slice(0, 8)}`,
              uploadUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dealer/deals/${dealId}`,
            });
          }
        } catch (err) {
          console.error("[deals/action] contract-pending email failed:", err);
        }
      }
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
      result = { overridden: true };

      // Notify the dealer that the contract had flagged issues which the admin overrode.
      try {
        const dealWithDealer = await prisma.deal.findUnique({
          where: { id: dealId },
          include: {
            offer: {
              include: { dealer: { include: { user: { select: { email: true } } } } },
            },
          },
        });
        const dealer = dealWithDealer?.offer?.dealer;
        if (dealer?.user?.email) {
          await sendDealerContractIssuesEmail({
            to: dealer.user.email,
            contactName: dealer.dealershipName,
            vehicleRef: `Deal ${dealId.slice(0, 8)}`,
            fixItems: [reason],
            contractUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dealer/deals/${dealId}`,
            dealId,
          });
        }
      } catch (err) {
        console.error("[deals/action] contract-issues email failed:", err);
      }
      break;
    }

    case "DEAL_CANCELLED": {
      await prisma.deal.update({ where: { id: dealId }, data: { status: "CANCELLED" } });
      result = { cancelled: true };
      break;
    }

    case "REFUND_TRIGGERED": {
      // Find the deposit payment intent and refund
      const deposit = await prisma.deposit.findFirst({
        where: { buyerId: deal.buyerId, status: "PAID" },
        orderBy: { createdAt: "desc" },
      });

      if (deposit?.stripePaymentIntentId) {
        try {
          await getStripe().refunds.create({ payment_intent: deposit.stripePaymentIntentId });
          await prisma.deposit.update({ where: { id: deposit.id }, data: { status: "REFUNDED", refundedAt: new Date() } });
        } catch (err) {
          return adminError("STRIPE_ERROR", `Refund failed: ${err}`, 500);
        }
      }

      await prisma.deal.update({ where: { id: dealId }, data: { status: "REFUNDED" } });

      // Notify buyer
      await prisma.notification.create({
        data: {
          buyerId: deal.buyerId,
          title: "Refund issued",
          body: "Your refund has been processed. Please allow 3–5 business days for funds to appear.",
          type: "DEAL_STAGE_CHANGED",
        },
      });

      result = { refunded: true };
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
