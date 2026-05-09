import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface Params { params: Promise<{ requestId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  await requireAdmin();
  const { requestId } = await params;
  const checkpoints = await prisma.vehicleRequestDueDiligenceCheckpoint.findMany({
    where: { requestId },
    orderBy: { order: "asc" },
  });
  return NextResponse.json({ success: true, data: { checkpoints } });
}

export async function POST(request: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  const { requestId } = await params;

  const body = await request.json() as { name?: string; description?: string; order?: number };
  if (!body.name) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "name is required" } }, { status: 422 });
  }

  const created = await prisma.vehicleRequestDueDiligenceCheckpoint.create({
    data: {
      requestId,
      name: body.name,
      description: body.description ?? null,
      order: body.order ?? 0,
    },
  });
  await prisma.vehicleRequestEvent.create({
    data: {
      requestId,
      eventType: "CHECKPOINT_CREATED",
      actorId: admin.adminId,
      actorRole: "ADMIN",
      payload: { checkpointId: created.id, name: created.name },
    },
  });

  return NextResponse.json({ success: true, data: { checkpoint: created } }, { status: 201 });
}
