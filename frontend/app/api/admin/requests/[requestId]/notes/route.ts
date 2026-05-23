import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

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

  const body = await request.json() as { notes?: string; sourceUrl?: string };
  if (!body.notes || body.notes.trim().length < 2) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "notes is required" } },
      { status: 422 },
    );
  }

  const log = await prisma.vehicleRequestResearchLog.create({
    data: {
      requestId,
      adminId: admin.adminId,
      notes: body.notes.trim(),
      sourceUrl: body.sourceUrl ?? null,
    },
  });

  await createAuditLog(admin, request, {
    action: "VEHICLE_REQUEST_RESEARCH_NOTE_ADDED",
    entityType: "VehicleRequest",
    entityId: requestId,
    metadata: { logId: log.id, sourceUrl: body.sourceUrl ?? null },
  });

  return NextResponse.json({ success: true, data: { log } }, { status: 201 });
}
