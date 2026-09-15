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
    select: {
      id: true,
      status: true,
      eSignEnvelopes: { select: { status: true, signerKind: true } },
      coBuyer: { select: { isRequiredSigner: true } },
    },
  });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  // §13-D30. WHICH ceremony this request is for. The co-buyer reaches the same route
  // through their invited link with `?signer=co-buyer`; anything else is the buyer's own.
  // A co-buyer ceremony is refused outright when the deal does not name one as a required
  // signer, so the query parameter cannot conjure a signer the deal never had.
  const requestedSigner =
    new URL(request.url).searchParams.get("signer") === "co-buyer" ? "CO_BUYER" : "BUYER";
  if (requestedSigner === "CO_BUYER" && !deal.coBuyer?.isRequiredSigner) {
    return errorResponse("NOT_FOUND", "This deal has no co-buyer signer", 404);
  }

  await expireIfElapsed(dealId, requestedSigner);
  // Advance only when EVERY required signer is done — ensureDealSigned re-derives that
  // itself, so this is a cheap pre-check rather than the decision.
  if (deal.eSignEnvelopes.some((e) => e.status === "COMPLETED")) await ensureDealSigned(dealId, buyer.id);

  const envelope = await readEnvelopeForDeal(dealId, requestedSigner);
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
    if (!envelope.viewedAt) await prisma.eSignEnvelope.update({ where: { dealId_signerKind: { dealId, signerKind: requestedSigner } }, data: { viewedAt: new Date() }, select: { id: true } }).catch(() => {});
    const contract = await prisma.contractVersion.findUnique({ where: { id: envelope.documentVersionId } });
    if (contract) contractViewUrl = await getContractViewUrl(contract.documentUrl);
  }

  // WHAT CONTRACT SHIELD FOUND, so the buyer can see it before signing.
  //
  // §14b describes a comparison run on the buyer's behalf, and the buyer had no way to see
  // its result: the ceremony rendered the contract and asked for a signature with the
  // review's outcome nowhere on the page. A buyer signing a legally binding contract is
  // entitled to know what was checked and what came back — that is the entire product
  // promise, and hiding it makes Contract Shield a thing we say rather than a thing they get.
  //
  // Bound to the SCAN THAT JUDGED THE SIGNED VERSION, not the newest scan on the deal. An
  // earlier revision's findings shown against this document would be actively misleading.
  const scan = envelope?.documentVersionId
    ? await prisma.contractScan.findFirst({
        where: { dealId, contractVersionId: envelope.documentVersionId },
        orderBy: { scannedAt: "desc" },
        select: { status: true, score: true, fixList: true, scannedAt: true },
      })
    : null;
  // The fix list is written by AutoLenis's own rules and comparison — no buyer PII, no
  // dealer identity, no internal ids beyond a rule key. Projected to the three fields the
  // buyer needs rather than passed through whole, so a future field cannot leak by default.
  const shieldFindings = Array.isArray(scan?.fixList)
    ? (scan!.fixList as Array<Record<string, unknown>>).map((f) => ({
        item: typeof f.item === "string" ? f.item : null,
        found: typeof f.foundValue === "string" ? f.foundValue : null,
        expected: typeof f.expectedValue === "string" ? f.expectedValue : null,
        howToFix: typeof f.howToFix === "string" ? f.howToFix : null,
      }))
    : [];

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
    shield: scan
      ? {
          status: scan.status,
          score: scan.score,
          scannedAt: scan.scannedAt,
          findings: shieldFindings,
          // The checks Shield runs, stated so an empty findings list reads as "we looked and
          // found nothing" rather than as "nothing was looked at" — which is the difference
          // between reassurance and a blank panel.
          checked: [
            "Vehicle and VIN, and the odometer reading",
            "Every out-the-door component against the recap you confirmed",
            "Documentation fee, taxes, title and registration",
            "Trade allowance and payoff figures, and your down payment",
            "Financing terms — APR and length",
            "Each optional product you accepted or declined, individually",
            "Junk-fee patterns, fee caps, payment packing and required disclosures",
          ],
        }
      : null,
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
