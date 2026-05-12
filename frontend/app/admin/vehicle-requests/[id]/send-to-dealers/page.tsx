import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import SendToDealersClient, { type SerializedOffer } from "./SendToDealersClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Send to Dealers" };

interface Props { params: Promise<{ id: string }> }

export default async function SendToDealersPage({ params }: Props) {
  const { id } = await params;
  await requireAdmin();

  const req = await prisma.notification.findUnique({ where: { id } });
  if (!req || !req.title?.startsWith("Vehicle Request:")) notFound();

  const meta = (req.metadata ?? {}) as Record<string, unknown>;

  const offer = await prisma.vehicleOffer.findFirst({
    where: { referenceId: id },
    include: { dealerInvites: { orderBy: { sentAt: "desc" } } },
  });

  const serialized: SerializedOffer | null = offer
    ? {
        id: offer.id,
        token: offer.token,
        vehicleYear: offer.vehicleYear,
        vehicleMake: offer.vehicleMake,
        vehicleModel: offer.vehicleModel,
        vehicleTrim: offer.vehicleTrim,
        vehicleCondition: offer.vehicleCondition,
        vehicleMileage: offer.vehicleMileage,
        vehicleVin: offer.vehicleVin,
        vehicleColor: offer.vehicleColor,
        vehicleInteriorColor: offer.vehicleInteriorColor,
        vehicleReferenceUrl: offer.vehicleReferenceUrl,
        askingPriceCents: offer.askingPriceCents,
        adminNotes: offer.adminNotes,
        expiresAt: offer.expiresAt ? offer.expiresAt.toISOString() : null,
        invitations: offer.dealerInvites.map((inv) => ({
          id: inv.id,
          dealershipName: inv.dealershipName,
          contactName: inv.contactName,
          dealerEmail: inv.dealerEmail,
          dealerPhone: inv.dealerPhone,
          status: inv.status,
          sentAt: inv.sentAt.toISOString(),
          expiresAt: inv.expiresAt ? inv.expiresAt.toISOString() : null,
        })),
      }
    : null;

  return (
    <SendToDealersClient
      requestId={id}
      meta={meta}
      offer={serialized}
      appUrl={process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com"}
    />
  );
}
