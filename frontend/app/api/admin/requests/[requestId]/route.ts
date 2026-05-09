// PATCH /api/admin/requests/[requestId] — admin status / assignment mutations.
// Allowed transitions for spec coverage:
//   action: "INTAKE"               → SUBMITTED → INTAKE
//   action: "ACTIVATE_SOURCING"    → INTAKE | SUBMITTED → ACTIVE_SOURCING
//   action: "CLOSE_NO_MATCH"       → any open state → CLOSED_NO_MATCH
//   action: "REOPEN_SOURCING"      → OFFER_DECLINED | CLOSED_NO_MATCH → ACTIVE_SOURCING
//   action: "CREATE_DEAL"          → OFFER_ACCEPTED → DEAL_CREATED
import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { VehicleRequestStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

interface Params { params: Promise<{ requestId: string }> }

const TRANSITIONS: Record<string, { from: VehicleRequestStatus[]; to: VehicleRequestStatus; eventType: string; buyerUpdate?: { title: string; body: string } }> = {
  INTAKE: {
    from: [VehicleRequestStatus.SUBMITTED],
    to: VehicleRequestStatus.INTAKE,
    eventType: "INTAKE_STARTED",
    buyerUpdate: { title: "Under review", body: "Our team is reviewing your request and starting research." },
  },
  ACTIVATE_SOURCING: {
    from: [VehicleRequestStatus.SUBMITTED, VehicleRequestStatus.INTAKE],
    to: VehicleRequestStatus.ACTIVE_SOURCING,
    eventType: "SOURCING_STARTED",
    buyerUpdate: { title: "Searching for options", body: "We're now actively searching for vehicles that match your request." },
  },
  CLOSE_NO_MATCH: {
    from: [
      VehicleRequestStatus.SUBMITTED, VehicleRequestStatus.INTAKE, VehicleRequestStatus.ACTIVE_SOURCING,
      VehicleRequestStatus.OFFER_READY, VehicleRequestStatus.OFFER_SENT, VehicleRequestStatus.OFFER_DECLINED,
    ],
    to: VehicleRequestStatus.CLOSED_NO_MATCH,
    eventType: "CLOSED_NO_MATCH",
    buyerUpdate: { title: "No match found", body: "We were unable to find a vehicle that matches your request. Your $99 deposit is fully refundable." },
  },
  REOPEN_SOURCING: {
    from: [VehicleRequestStatus.OFFER_DECLINED, VehicleRequestStatus.CLOSED_NO_MATCH],
    to: VehicleRequestStatus.ACTIVE_SOURCING,
    eventType: "REOPENED",
  },
  CREATE_DEAL: {
    from: [VehicleRequestStatus.OFFER_ACCEPTED],
    to: VehicleRequestStatus.DEAL_CREATED,
    eventType: "DEAL_CREATED",
    buyerUpdate: { title: "Deal in progress", body: "Your offer has been accepted and a deal has been created. Our team will be in touch shortly." },
  },
};

export async function PATCH(request: NextRequest, { params }: Params) {
  const admin = await getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin session required" } },
      { status: 401 },
    );
  }
  const { requestId } = await params;

  const body = await request.json() as { action?: string; assignedAdminId?: string };
  if (!body.action) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "action is required" } }, { status: 422 });
  }

  const transition = TRANSITIONS[body.action];
  if (!transition) {
    return NextResponse.json({ error: { code: "INVALID_ACTION", message: `Unknown action: ${body.action}` } }, { status: 422 });
  }

  const req = await prisma.vehicleRequest.findUnique({ where: { id: requestId } });
  if (!req) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Request not found" } }, { status: 404 });

  if (!transition.from.includes(req.status)) {
    return NextResponse.json(
      { error: { code: "INVALID_TRANSITION", message: `Cannot ${body.action} from status ${req.status}` } },
      { status: 409 },
    );
  }

  const updated = await prisma.vehicleRequest.update({
    where: { id: requestId },
    data: {
      status: transition.to,
      ...(body.assignedAdminId ? { assignedAdminId: body.assignedAdminId } : {}),
    },
  });
  await prisma.vehicleRequestEvent.create({
    data: {
      requestId,
      eventType: transition.eventType,
      actorId: admin.adminId,
      actorRole: "ADMIN",
      payload: { from: req.status, to: transition.to },
    },
  });
  if (transition.buyerUpdate) {
    await prisma.vehicleRequestBuyerUpdate.create({
      data: { requestId, title: transition.buyerUpdate.title, body: transition.buyerUpdate.body },
    });
  }

  return NextResponse.json({ success: true, data: { request: updated } });
}
