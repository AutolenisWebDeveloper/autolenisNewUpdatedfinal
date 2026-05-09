// lib/services/vehicle-request/vehicle-request-offer.service.ts
import { prisma } from "@/lib/prisma";
import { VehicleRequestStatus } from "@prisma/client";

export async function createAndSendOffer(requestId: string, adminId: string, vehicleInfo: Record<string, unknown>, priceCents: number, notes?: string) {
  // Verify all due diligence checkpoints complete (gate enforcement)
  const req = await prisma.vehicleRequest.findUnique({ where: { id: requestId }, include: { checkpoints: true } });
  if (!req) throw new Error("Request not found");

  const incomplete = req.checkpoints.filter(c => !c.completed);
  if (incomplete.length > 0) throw new Error(`${incomplete.length} due diligence checkpoint(s) incomplete. Cannot send offer.`);

  const offer = await prisma.vehicleRequestOffer.create({
    data: { requestId, vehicleInfo: vehicleInfo as object, priceCents, notes, status: "SENT", sentAt: new Date() },
  });

  await prisma.vehicleRequest.update({ where: { id: requestId }, data: { status: VehicleRequestStatus.OFFER_SENT } });
  await prisma.vehicleRequestEvent.create({ data: { requestId, eventType: "OFFER_SENT", actorId: adminId, actorRole: "ADMIN", payload: { offerId: offer.id } } });

  return offer;
}

export async function getActiveOffer(requestId: string) {
  return prisma.vehicleRequestOffer.findFirst({ where: { requestId, status: "SENT" }, orderBy: { createdAt: "desc" } });
}
