// lib/services/documents/document-verification.service.ts
import { prisma } from "@/lib/prisma";

export async function verifyDocument(documentId: string, verifiedBy: string) {
  return prisma.document.update({ where: { id: documentId }, data: { isVerified: true, verifiedAt: new Date(), verifiedBy } });
}

export async function getUnverifiedDocuments(limit = 20) {
  return prisma.document.findMany({ where: { isVerified: false }, orderBy: { uploadedAt: "asc" }, take: limit });
}

export async function getDocumentsByDeal(dealId: string) {
  return prisma.document.findMany({ where: { dealId } });
}
