// POST /api/admin/requests/[requestId]/offer — admin creates and sends offer
// GET  /api/admin/requests/[requestId]/offer — list offers for the request
// Spec: System 4C step 7. All due-diligence checkpoints must be complete first.
import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { createAndSendOffer } from "@/lib/services/vehicle-request/vehicle-request-offer.service";

export const dynamic = "force-dynamic";

interface Params { params: Promise<{ requestId: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const admin = await getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin session required" } },
      { status: 401 },
    );
  }
  const { requestId } = await params;

  const vrequest = await prisma.vehicleRequest.findUnique({
    where: { id: requestId },
    select: { id: true },
  });
  if (!vrequest) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Request not found" } },
      { status: 404 },
    );
  }

  const offers = await prisma.vehicleRequestOffer.findMany({
    where: { requestId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ success: true, data: { offers } });
}

export async function POST(request: NextRequest, { params }: Params) {
  const admin = await getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin session required" } },
      { status: 401 },
    );
  }
  const { requestId } = await params;

  const body = await request.json() as {
    vehicleInfo?: Record<string, unknown>;
    priceCents?: number;
    notes?: string;
  };

  if (!body.vehicleInfo || typeof body.priceCents !== "number" || body.priceCents <= 0) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "vehicleInfo and positive priceCents required" } },
      { status: 422 },
    );
  }

  try {
    const offer = await createAndSendOffer(
      requestId,
      admin.adminId,
      body.vehicleInfo,
      body.priceCents,
      body.notes,
    );
    await createAuditLog(admin, request, {
      action: "VEHICLE_REQUEST_OFFER_SENT",
      entityType: "VehicleRequest",
      entityId: requestId,
      metadata: { offerId: (offer as { id?: string })?.id ?? null, priceCents: body.priceCents },
    });
    return NextResponse.json({ success: true, data: { offer } }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to create offer";
    const status = message.includes("not found") ? 404
                 : message.includes("checkpoint") ? 409
                 : 400;
    return NextResponse.json(
      { error: { code: "OFFER_CREATE_FAILED", message } },
      { status },
    );
  }
}
