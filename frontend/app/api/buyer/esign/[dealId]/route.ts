import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { advanceDealStatus, DealTransitionError } from "@/lib/services/deal/deal.service";
import {
  prepareBuyerSigningEnvelope,
  getContractViewUrl,
  ensureDealSigned,
  expireIfElapsed,
  NoSignableDocumentError,
  ESignSchemaUnavailableError,
  readEnvelopeForDeal,
} from "@/lib/services/esign/buyer-signing.service";
import { toBuyerEnvelopeSummary } from "@/lib/services/esign/esign-dto";
import { isExecutedArtifactEnabled } from "@/lib/services/esign/esign-schema-gate";

interface Props { params: Promise<{ dealId: string }> }

// GET — buyer reads their in-house signing state. Returns the envelope, the
// deal status, and (when signable) a short-lived URL to VIEW the contract being
// signed. Self-heals a completed-but-not-yet-SIGNED deal and lazily expires a
// stale signing window — no reconciliation cron needed.
export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  // Explicit projection: `include: { eSignEnvelope: true }` selects every envelope
  // scalar, including the columns migrations 20261014/20261015 add but production
  // does not yet have. Only the status is needed here.
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id },
    select: { id: true, status: true, eSignEnvelope: { select: { status: true } } },
  });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  await expireIfElapsed(dealId);
  if (deal.eSignEnvelope?.status === "COMPLETED") await ensureDealSigned(dealId, buyer.id);

  const envelope = await readEnvelopeForDeal(dealId);
  let contractViewUrl: string | null = null;
  // recordBuyerSignature fails closed while the schema gate is closed, so a
  // "signable" envelope would render a ceremony whose submit can only 503. Report
  // it truthfully as not signable instead.
  const signable =
    isExecutedArtifactEnabled() &&
    (envelope?.status === "SENT" || envelope?.status === "DELIVERED" || envelope?.status === "PENDING");
  if (signable && envelope?.documentVersionId) {
    // Record first-view evidence (best-effort) and mint a view URL.
    // Narrowed RETURNING — an unprojected update returns every scalar.
    if (!envelope.viewedAt) await prisma.eSignEnvelope.update({ where: { dealId }, data: { viewedAt: new Date() }, select: { id: true } }).catch(() => {});
    const contract = await prisma.contractVersion.findUnique({ where: { id: envelope.documentVersionId } });
    if (contract) contractViewUrl = await getContractViewUrl(contract.documentUrl);
  }

  const fresh = await prisma.deal.findUnique({ where: { id: dealId }, select: { status: true } });
  // §11: return ONLY a buyer-safe summary — never the raw envelope (which carries
  // IP, user-agent, the consent snapshot's forensic attribution, and internal
  // identifiers). `status` is surfaced top-level for the ceremony client.
  const summary = toBuyerEnvelopeSummary(envelope);
  return successResponse({
    status: summary?.status ?? null,
    envelope: summary,
    dealStatus: fresh?.status ?? deal.status,
    contractViewUrl,
    signable: !!signable,
  });
}

// POST — begin signing: prepare the in-house envelope (bound to the approved
// contract by hash) and move the deal to SIGNING_PENDING. Contract Shield hard
// gate enforced. No external provider, no signing URL — the buyer signs in-app.
export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id },
    include: { buyer: { include: { user: { select: { email: true } } } } },
  });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  // Contract Shield hard gate: signing is available only after CONTRACT_APPROVED.
  if (deal.status !== "CONTRACT_APPROVED" && deal.status !== "SIGNING_PENDING") {
    return errorResponse(
      "CONTRACT_NOT_APPROVED",
      "This contract has not been approved yet. Signing becomes available after Contract Shield review passes.",
      409,
    );
  }

  try {
    const signerName = [deal.buyer?.firstName, deal.buyer?.lastName].filter(Boolean).join(" ") || null;
    const prepared = await prepareBuyerSigningEnvelope(dealId, {
      signerUserId: buyer.id,
      signerName: signerName ?? undefined,
      signerEmail: deal.buyer?.user?.email ?? undefined,
    });

    if (deal.status === "CONTRACT_APPROVED") {
      try {
        await advanceDealStatus(dealId, "SIGNING_PENDING", { actorId: buyer.id, actorRole: "BUYER" });
      } catch (err) {
        if (err instanceof DealTransitionError) {
          return errorResponse("CONTRACT_NOT_APPROVED", "Signing is not available from the current deal state.", 409);
        }
        throw err;
      }
    }

    const contract = prepared.documentVersionId
      ? await prisma.contractVersion.findUnique({ where: { id: prepared.documentVersionId } })
      : null;
    const contractViewUrl = contract ? await getContractViewUrl(contract.documentUrl) : null;

    return successResponse({ envelopeId: prepared.envelopeId, status: prepared.status, contractViewUrl });
  } catch (err) {
    if (err instanceof ESignSchemaUnavailableError) {
      logger.warn("[buyer/esign] prepare refused — e-sign schema gate closed:", err);
      return errorResponse("ESIGN_UNAVAILABLE", "Electronic signing is temporarily unavailable while contract e-signature compliance review is completed. Your deal is unaffected — our team will reach out with next steps.", 503);
    }
    if (err instanceof NoSignableDocumentError) {
      return errorResponse("NO_SIGNABLE_DOCUMENT", "The approved contract is not available to sign yet. Please try again shortly.", 409);
    }
    logger.error("[buyer/esign] failed to prepare in-house signing:", err);
    return errorResponse("INTERNAL_ERROR", "We couldn't start the signing process. Please try again.", 500);
  }
}
