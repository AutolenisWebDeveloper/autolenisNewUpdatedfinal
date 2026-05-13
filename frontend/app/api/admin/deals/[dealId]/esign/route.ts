// POST /api/admin/deals/[dealId]/esign/send
// Triggers DocuSign envelope creation for a deal
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { createEnvelope } from "@/lib/services/esign/esign.service";
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

  const signerEmail = deal.buyer.user.email;
  const signerName = `${deal.buyer.firstName} ${deal.buyer.lastName}`;

  const result = await createEnvelope(dealId, signerEmail, signerName);

  // Notify the dealer side that the e-sign flow has started — non-blocking.
  if (!result.error) {
    const dealerEmail = deal.offer?.dealer?.user?.email;
    if (dealerEmail) {
      await sendDealerEsignInitiatedEmail({
        to: dealerEmail,
        contactName: deal.offer.dealer.dealershipName,
        vehicleRef: `Deal ${dealId.slice(0, 8)}`,
        signingUrl: result.signingUrl ?? `${APP_URL}/dealer/deals/${dealId}`,
        dealId,
      }).catch(err => console.error("[esign] dealer notification failed:", err));
    }
  }

  return adminSuccess({
    envelopeId: result.envelopeId,
    signingUrl: result.signingUrl,
    isMock: result.isMock,
    error: result.error ?? null,
  });
}
