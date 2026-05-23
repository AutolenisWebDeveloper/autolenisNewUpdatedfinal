import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({ text: z.string().min(1), placement: z.string().min(1) });

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const messages = await prisma.encouragementMessage.findMany({ orderBy: { placement: "asc" } });
  return adminSuccess({ messages });
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.message, 400);
  const message = await prisma.encouragementMessage.create({ data: { text: parsed.data.text, placement: parsed.data.placement, isActive: true, order: 0 } });
  await createAuditLog(admin, request, {
    action: "FAITH_ENCOURAGEMENT_MESSAGE_CREATED",
    entityType: "EncouragementMessage",
    entityId: message.id,
    metadata: { placement: parsed.data.placement },
  });
  return adminSuccess({ message }, 201);
}
