// POST /api/admin/deals/[dealId]/esign/send
// Prepares the in-house signing envelope for a deal (buyer signs in-app).
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { prepareBuyerSigningEnvelope, NoSignableDocumentError, ESignSchemaUnavailableError } from "@/lib/services/esign/buyer-signing.service";
import { sendDealerEsignInitiatedEmail } from "@/lib/services/email/resend.service";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

interface Props { params: Promise<{ dealId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { dealId } = await params;
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      buyer: { include: { user: true } },
      offer: { include: { dealer: { include: { user: { select: { email: true } } } } } },
    },
  });
  if (!deal) return adminError("NOT_FOUND", "Deal not found", 404);

  // Contract Shield hard gate — parity with the buyer path
  // (app/api/buyer/esign/[dealId]/route.ts). An envelope may only be created once
  // the deal has passed Contract Shield review (CONTRACT_APPROVED), or is already
  // in SIGNING_PENDING (re-send). Admin auth alone is NOT sufficient to bypass the
  // compliance gate.
  if (deal.status !== "CONTRACT_APPROVED" && deal.status !== "SIGNING_PENDING") {
    return adminError(
      "CONTRACT_NOT_APPROVED",
      "This contract has not been approved yet. Signing becomes available after Contract Shield review passes.",
      409,
    );
  }

  const signerEmail = deal.buyer.user.email;
  const signerName = `${deal.buyer.firstName} ${deal.buyer.lastName}`;

  let envelopeId: string;
  try {
    const prepared = await prepareBuyerSigningEnvelope(dealId, { signerName, signerEmail: signerEmail ?? undefined });
    envelopeId = prepared.envelopeId;
  } catch (err) {
    if (err instanceof ESignSchemaUnavailableError) {
      logger.warn("[esign] admin prepare refused — e-sign schema gate closed:", err);
      return adminError(
        "ESIGN_UNAVAILABLE",
        "Electronic signing is disabled: ESIGN_EXECUTED_ARTIFACT_ENABLED is off because the consent / " +
          "executed-artifact migrations (20261014, 20261015) are not applied to this database.",
        503,
      );
    }
    if (err instanceof NoSignableDocumentError) {
      return adminError("NO_SIGNABLE_DOCUMENT", "No approved contract is available to sign for this deal yet.", 409);
    }
    logger.error("[esign] admin prepare signing envelope failed:", err);
    return adminError("INTERNAL_ERROR", "Could not prepare the signing envelope.", 500);
  }

  // Notify the dealer that BUYER signing has started — informational only. The
  // dealer does not sign; they'll receive an executed copy once the buyer signs.
  // Link to the dealer's own deal page (never a buyer signing URL).
  const dealerEmail = deal.offer?.dealer?.user?.email;
  if (dealerEmail) {
    await sendDealerEsignInitiatedEmail({
      to: dealerEmail,
      contactName: deal.offer?.dealer?.dealershipName ?? "",
      vehicleRef: `Deal ${dealId.slice(0, 8)}`,
      dealUrl: `${APP_URL}/dealer/deals/${dealId}`,
      dealId,
    }).catch(err => logger.error("[esign] dealer notification failed:", err));
  }

  return adminSuccess({ envelopeId, isMock: false, error: null });
}
