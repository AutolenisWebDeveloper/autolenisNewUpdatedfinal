// lib/services/documents/document.service.ts — System 21

import { prisma } from "@/lib/prisma";
import { DocumentType, DocumentRequestStatus } from "@prisma/client";

export async function uploadDocument(data: {
  buyerId?: string; dealerId?: string; dealId?: string;
  type: DocumentType; name: string; url: string; mimeType?: string; sizeBytes?: number;
}) {
  return prisma.document.create({ data: { ...data } });
}

export async function getBuyerDocuments(buyerId: string) {
  return prisma.document.findMany({ where: { buyerId }, orderBy: { uploadedAt: "desc" } });
}

export async function getDealDocuments(dealId: string) {
  return prisma.document.findMany({ where: { dealId }, orderBy: { uploadedAt: "desc" } });
}

export async function verifyDocument(documentId: string, verifiedBy: string) {
  return prisma.document.update({
    where: { id: documentId },
    data: { isVerified: true, verifiedAt: new Date(), verifiedBy },
  });
}

/**
 * Open a deal-scoped document request.
 *
 * PHASE 8 REUSED THIS RATHER THAN BUILDING A SECOND ONE (§8.2 Phase 8, defect 6).
 * `document_requests` has modelled a deal-scoped request with a due date since the
 * original schema, and `dueAt` had never been written by anything — this function did
 * not even accept it, and nothing called this function at all. Stage 13/14a needs
 * exactly what the table already models, so the fix is a parameter, not a new table.
 *
 * `dueAt` is what the overdue sweep reads. A request opened without one can never go
 * overdue, so the deadline is not decoration: it is the escalation's only input.
 *
 * IDEMPOTENT PER (deal, type) while a request is still PENDING. A deal can arrive at
 * CONTRACT_PENDING more than once — CONTRACT_REVIEW → CONTRACT_PENDING is a legal edge
 * for a re-submit — and a second arrival must not open a second request or, worse,
 * restart a 24-hour clock that has been running.
 */
export async function requestDocument(
  dealId: string,
  documentType: DocumentType,
  requestedBy: string,
  reason?: string,
  opts: { dueAt?: Date; buyerId?: string | null } = {},
) {
  const existing = await prisma.documentRequest.findFirst({
    where: { dealId, documentType, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  // `reused` is returned rather than left for the caller to infer. Inferring it by comparing
  // the row's createdAt against a caller-supplied clock is fragile in exactly the way that
  // matters here: a caller passing an explicit `now` (a test, a backfill, a replayed job)
  // reads a freshly created row as pre-existing and silently skips the dispatch, so the
  // dealership is never asked and the deadline runs against them anyway.
  if (existing) return { ...existing, reused: true as const };

  const row = await prisma.documentRequest.create({
    data: {
      dealId,
      documentType,
      requestedBy,
      reason,
      dueAt: opts.dueAt ?? null,
      buyerId: opts.buyerId ?? null,
    },
  });
  return { ...row, reused: false as const };
}

/**
 * Close a deal-scoped document request. The status the sweep reads to decide whether a
 * deadline is still live, so fulfilment has to write it — a request that is answered but
 * left PENDING produces an overdue escalation against a dealership that already complied.
 */
export async function fulfilDocumentRequest(
  dealId: string,
  documentType: DocumentType,
  status: "SUBMITTED" | "VERIFIED" | "REJECTED" = "SUBMITTED",
) {
  return prisma.documentRequest.updateMany({
    where: { dealId, documentType, status: "PENDING" },
    data: { status, fulfilledAt: status === "REJECTED" ? null : new Date() },
  });
}
