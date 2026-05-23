// POST /api/admin/buyers/[buyerId]/journey/notify
// Sends a buyer reminder notification for a specific journey stage.
// Composes existing triggerBuyerReminder — no new notification logic.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { triggerBuyerReminder } from "@/lib/services/admin/admin-buyer-command-center.service";
import { DEPOSIT_AMOUNT_USD } from "@/lib/constants";
import { z } from "zod";

interface Props { params: Promise<{ buyerId: string }> }

const DEFAULT_MESSAGES: Record<string, string> = {
  onboarding:    "Please complete your profile setup to continue your car buying journey.",
  prequal:       "Check your buying power — complete pre-qualification to see what you qualify for.",
  search:        "Browse our inventory and shortlist vehicles you're interested in.",
  shortlist:     "Shortlist vehicles you love so we can source competitive dealer offers.",
  deposit:       `Activate your dealer auction with a ${DEPOSIT_AMOUNT_USD} refundable deposit.`,
  auction:       "Your dealer auction is active — dealer offers are being collected.",
  "select-deal": "Your auction has closed — review dealer offers and select your best deal.",
  financing:     "Choose your financing path to continue with your selected deal.",
  fee:           "Pay the AutoLenis concierge fee to proceed with your deal.",
  insurance:     "Arrange insurance coverage for your vehicle to continue.",
  contract:      "Your purchase contract is ready for review.",
  sign:          "Your documents are ready — please review and sign your purchase agreement.",
  pickup:        "Your vehicle is ready — schedule your pickup or delivery.",
};

const schema = z.object({
  stageId: z.string().min(1),
  reason: z.string().min(1),
  message: z.string().max(500).optional(),
});

export async function POST(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { buyerId } = await params;
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { id: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid", 400);
  }

  const { stageId, reason } = parsed.data;
  const message = parsed.data.message
    || DEFAULT_MESSAGES[stageId]
    || "Please continue your buying journey on AutoLenis.";

  await triggerBuyerReminder(buyerId, admin.adminId, admin.email, message, reason);

  return adminSuccess({ notified: true, stageId });
}
