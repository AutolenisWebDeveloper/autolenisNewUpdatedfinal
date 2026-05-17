import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ token: string }> }

const schema = z.object({
  vehiclePriceCents: z.number().int().min(0),
  taxCents:          z.number().int().min(0),
  feesCents:         z.number().int().min(0),
  otdPriceCents:     z.number().int().min(100),
  notes:             z.string().max(2000).optional(),
});

function err(code: string, message: string, status = 400) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function POST(request: NextRequest, { params }: Props) {
  const { token } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return err("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }
  const { vehiclePriceCents, taxCents, feesCents, otdPriceCents, notes } = parsed.data;

  const invite = await prisma.outsideAuctionInvite.findUnique({
    where: { token },
    include: { auction: { select: { id: true, status: true, endsAt: true } } },
  });
  if (!invite) return err("NOT_FOUND", "Invitation not found", 404);

  if (invite.respondedAt) {
    return err("ALREADY_SUBMITTED", "An offer has already been submitted for this invitation.", 400);
  }
  if (invite.auction.status !== "ACTIVE") {
    return err("AUCTION_INACTIVE", "This auction is no longer active.", 400);
  }
  if (invite.auction.endsAt && invite.auction.endsAt < new Date()) {
    return err("AUCTION_EXPIRED", "This auction has expired.", 400);
  }

  await prisma.outsideAuctionInvite.update({
    where: { id: invite.id },
    data: {
      respondedAt:        new Date(),
      offerOtdCents:      otdPriceCents,
      offerVehicleCents:  vehiclePriceCents,
      offerTaxCents:      taxCents,
      offerFeesCents:     feesCents,
      offerNotes:         notes ?? null,
    },
  });

  return NextResponse.json({ success: true, data: { received: true } });
}
