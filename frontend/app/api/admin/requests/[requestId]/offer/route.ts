// POST /api/admin/requests/[requestId]/offer — admin creates and sends offer
// Spec: System 4C step 7. All due-diligence checkpoints must be complete first.
import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest } from "@/lib/auth/admin-api";
import { createAndSendOffer } from "@/lib/services/vehicle-request/vehicle-request-offer.service";

export const dynamic = "force-dynamic";

interface Params { params: Promise<{ requestId: string }> }

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
