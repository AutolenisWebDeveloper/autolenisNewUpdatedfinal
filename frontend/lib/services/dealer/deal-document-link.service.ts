// lib/services/dealer/deal-document-link.service.ts
//
// Robust document-to-deal association for dealer-uploaded deal documents
// (sales contracts, finance agreements, buyer orders, etc.).
//
// Goals:
//  - Every deal document is linked to exactly one Deal and is fully traceable
//    by Deal ID, Buyer ID, Dealer ID, and Transaction ID.
//  - Associations are verified, never guessed: the deal must belong to the
//    authenticated dealer (via the accepted offer's dealerId), and any
//    client-supplied identifiers (buyer / VIN / transaction) are cross-checked
//    against the deal's authoritative values before linking. A mismatch is
//    rejected rather than silently mis-associated.
//  - Orphans are impossible (a dealId that does not resolve to an owned deal is
//    rejected) and duplicates are collapsed idempotently.
//
// This intentionally uses only existing Document columns (dealId, buyerId,
// dealerId, type) so it ships with no schema migration. Identifiers that have
// no dedicated column (VIN, transaction id) are recorded in the audit trail for
// full auditability.

import { prisma } from "@/lib/prisma";
import { DocumentType, type Document } from "@prisma/client";
import { writeDealerAudit } from "@/lib/services/audit/dealer-audit.service";

/** Typed failure carrying an HTTP status + machine code for the API layer. */
export class DealDocumentError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "DealDocumentError";
    this.code = code;
    this.status = status;
  }
}

export interface DealDocumentInput {
  dealerId: string;
  dealerUserId?: string | null;
  dealId: string;
  type: DocumentType;
  name: string;
  url: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  // Optional client-supplied identifiers, cross-validated against the deal.
  expectedBuyerId?: string | null;
  expectedVin?: string | null;
  expectedTransactionId?: string | null;
}

export interface ResolvedDealAssociation {
  dealId: string;
  buyerId: string;
  dealerId: string;
  transactionId: string | null;
  vins: string[];
}

export interface DealDocumentResult {
  document: Document;
  deduped: boolean;
  resolved: ResolvedDealAssociation;
}

export function normalizeVin(vin: string): string {
  return vin.trim().toUpperCase();
}

/**
 * Loads the deal with everything needed to authorize and describe the
 * association, and enforces dealer ownership via the accepted offer's dealerId
 * (the same ownership model used across the dealer portal). Throws
 * DealDocumentError for a missing deal (404) or a non-owned deal (403) so
 * orphaned / cross-dealer associations are impossible.
 */
export async function resolveOwnedDealAssociation(
  dealId: string,
  dealerId: string,
): Promise<ResolvedDealAssociation> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      buyerId: true,
      stripeFeePIId: true,
      offer: {
        select: {
          dealerId: true,
          auction: {
            select: {
              vehicles: {
                select: { inventoryItem: { select: { vin: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (!deal) {
    throw new DealDocumentError("DEAL_NOT_FOUND", "No matching deal was found.", 404);
  }
  // A dealer owns a deal only when its accepted offer is theirs. Deals created
  // through the admin concierge path (vehicleRequestOffer) have no dealer-portal
  // owner and are intentionally not linkable here.
  if (!deal.offer || deal.offer.dealerId !== dealerId) {
    throw new DealDocumentError(
      "FORBIDDEN",
      "This deal is not associated with your dealership.",
      403,
    );
  }

  const vins = Array.from(
    new Set(
      (deal.offer.auction?.vehicles ?? [])
        .map((v) => v.inventoryItem?.vin)
        .filter((vin): vin is string => !!vin)
        .map(normalizeVin),
    ),
  );

  return {
    dealId: deal.id,
    buyerId: deal.buyerId,
    dealerId,
    transactionId: deal.stripeFeePIId ?? null,
    vins,
  };
}

/**
 * Validates any client-supplied identifiers against the resolved deal. Each is
 * optional, but if provided it must match — this is what prevents a correct
 * deal id paired with the wrong buyer/vehicle/transaction from being linked.
 */
export function assertIdentifiersMatch(input: DealDocumentInput, resolved: ResolvedDealAssociation): void {
  if (input.expectedBuyerId && input.expectedBuyerId !== resolved.buyerId) {
    throw new DealDocumentError(
      "BUYER_MISMATCH",
      "The provided buyer does not match this deal.",
      409,
    );
  }
  if (input.expectedTransactionId && resolved.transactionId &&
      input.expectedTransactionId !== resolved.transactionId) {
    throw new DealDocumentError(
      "TRANSACTION_MISMATCH",
      "The provided transaction id does not match this deal.",
      409,
    );
  }
  // VIN is validated only when the deal carries one or more known VINs.
  if (input.expectedVin && resolved.vins.length > 0) {
    const wanted = normalizeVin(input.expectedVin);
    if (!resolved.vins.includes(wanted)) {
      throw new DealDocumentError(
        "VIN_MISMATCH",
        "The provided VIN does not match the vehicle on this deal.",
        409,
      );
    }
  }
}

/**
 * Links a dealer-uploaded document to a deal: validates ownership + identifiers,
 * collapses exact re-uploads idempotently, persists the association, and writes
 * an audit record. Returns the (new or existing) document plus the resolved
 * identifiers for the caller to surface.
 */
export async function linkDealDocument(input: DealDocumentInput): Promise<DealDocumentResult> {
  const resolved = await resolveOwnedDealAssociation(input.dealId, input.dealerId);
  assertIdentifiersMatch(input, resolved);

  // Idempotency: an identical re-upload (same deal, dealer, type, name, size)
  // returns the existing record instead of creating a duplicate. Prevents the
  // double-click / retry duplicate-record problem without a content-hash column.
  const duplicate = await prisma.document.findFirst({
    where: {
      dealId: resolved.dealId,
      dealerId: input.dealerId,
      type: input.type,
      name: input.name,
      sizeBytes: input.sizeBytes ?? undefined,
    },
    orderBy: { uploadedAt: "desc" },
  });
  if (duplicate) {
    return { document: duplicate, deduped: true, resolved };
  }

  const document = await prisma.document.create({
    data: {
      dealId: resolved.dealId,
      buyerId: resolved.buyerId,
      dealerId: input.dealerId,
      type: input.type,
      name: input.name,
      url: input.url,
      mimeType: input.mimeType ?? undefined,
      sizeBytes: input.sizeBytes ?? undefined,
    },
  });

  await writeDealerAudit({
    action: "DEALER_DEAL_DOCUMENT_LINKED",
    dealerId: input.dealerId,
    dealerUserId: input.dealerUserId,
    entityType: "Document",
    entityId: document.id,
    metadata: {
      dealId: resolved.dealId,
      buyerId: resolved.buyerId,
      transactionId: resolved.transactionId,
      vins: resolved.vins,
      type: input.type,
      name: input.name,
      sizeBytes: input.sizeBytes ?? null,
    },
  });

  return { document, deduped: false, resolved };
}
