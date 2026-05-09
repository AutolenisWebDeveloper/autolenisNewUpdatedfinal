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

export async function requestDocument(dealId: string, documentType: DocumentType, requestedBy: string, reason?: string) {
  return prisma.documentRequest.create({
    data: { dealId, documentType, requestedBy, reason },
  });
}
