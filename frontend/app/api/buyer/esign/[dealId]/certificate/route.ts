import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { esignEnvelopeSelect } from "@/lib/services/esign/envelope-schema";
import { finalizeBuyerSignatureCertificate } from "@/lib/services/esign/buyer-signing.service";
import { getBuyerContractCertificateUrl } from "@/lib/services/esign/buyer-contract-certificate.service";

interface Props { params: Promise<{ dealId: string }> }

// GET — a short-lived signed URL to the buyer's own signature evidence
// certificate. Ownership is always resolved from the session (IDOR-safe: a buyer
// can never fetch another buyer's certificate by changing the dealId). If the
// certificate has not been generated yet (or a prior generation blipped), it is
// regenerated on demand — this is the recovery path, so no cron is needed.
export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findFirst({ where: { id: dealId, buyerId: buyer.id }, include: { eSignEnvelope: { select: esignEnvelopeSelect() } } });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);
  if (deal.eSignEnvelope?.status !== "COMPLETED") {
    return errorResponse("NOT_READY", "Your signature certificate is not available yet.", 202);
  }

  let path = deal.eSignEnvelope.certificatePdfPath;
  if (!path) path = await finalizeBuyerSignatureCertificate(dealId);
  if (!path) return errorResponse("NOT_READY", "Your signature certificate is being generated. Please try again shortly.", 202);

  const url = await getBuyerContractCertificateUrl(path);
  if (!url) return errorResponse("NOT_READY", "Your signature certificate is being generated. Please try again shortly.", 202);
  return successResponse({ certificateUrl: url });
}
