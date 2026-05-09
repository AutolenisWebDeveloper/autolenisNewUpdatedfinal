import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";
import QRCode from "qrcode";

interface Props { params: Promise<{ dealId: string }> }

const QR_TTL_HOURS = 72;

// POST /api/buyer/pickup/[dealId]/qr — generate a one-time pickup token + QR code.
export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findFirst({ where: { id: dealId, buyerId: buyer.id } });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  const qrToken = randomBytes(24).toString("hex");
  const qrExpiresAt = new Date(Date.now() + QR_TTL_HOURS * 60 * 60 * 1000);
  const qrPayload = JSON.stringify({ dealId, token: qrToken });
  const qrCodeBase64 = await QRCode.toDataURL(qrPayload);

  await prisma.pickup.upsert({
    where: { dealId },
    create: {
      dealId,
      status: "SCHEDULED",
      qrCodeData: qrToken,
      qrCodeImage: qrCodeBase64,
      qrExpiresAt,
    },
    update: {
      qrCodeData: qrToken,
      qrCodeImage: qrCodeBase64,
      qrExpiresAt,
      status: "SCHEDULED",
    },
  });

  return successResponse({ qrToken, qrCodeBase64, expiresAt: qrExpiresAt });
}
