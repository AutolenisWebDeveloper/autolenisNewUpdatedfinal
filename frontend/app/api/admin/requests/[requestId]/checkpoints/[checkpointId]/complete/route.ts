import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface Params { params: Promise<{ requestId: string; checkpointId: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const admin = await getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin session required" } },
      { status: 401 },
    );
  }
  const { requestId, checkpointId } = await params;

  const cp = await prisma.vehicleRequestDueDiligenceCheckpoint.findFirst({
    where: { id: checkpointId, requestId },
  });
  if (!cp) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Checkpoint not found" } }, { status: 404 });
  }
  if (cp.completed) {
    return NextResponse.json({ success: true, data: { checkpoint: cp } });
  }

  const updated = await prisma.vehicleRequestDueDiligenceCheckpoint.update({
    where: { id: checkpointId },
    data: { completed: true, completedAt: new Date(), completedBy: admin.adminId },
  });
  await prisma.vehicleRequestEvent.create({
    data: {
      requestId,
      eventType: "CHECKPOINT_COMPLETED",
      actorId: admin.adminId,
      actorRole: "ADMIN",
      payload: { checkpointId, name: cp.name },
    },
  });

  return NextResponse.json({ success: true, data: { checkpoint: updated } });
}
