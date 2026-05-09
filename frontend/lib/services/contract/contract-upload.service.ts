// lib/services/contract/contract-upload.service.ts
import { prisma } from "@/lib/prisma";
import { validateUpload } from "@/lib/services/documents/document-upload.service";

export async function uploadContract(dealId: string, uploadedBy: string, documentUrl: string, mimeType: string, sizeBytes: number) {
  const validation = validateUpload(mimeType, sizeBytes);
  if (!validation.valid) throw new Error(validation.reason);

  const existing = await prisma.contractVersion.findMany({ where: { dealId }, orderBy: { version: "desc" }, take: 1 });
  const version = (existing[0]?.version ?? 0) + 1;

  return prisma.contractVersion.create({ data: { dealId, documentUrl, version, uploadedBy, status: "UPLOADED" } });
}
