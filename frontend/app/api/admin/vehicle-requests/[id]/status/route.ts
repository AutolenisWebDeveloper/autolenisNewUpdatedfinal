// PATCH /api/admin/vehicle-requests/[id]/status — update the requestStatus
// stored in the notification metadata for a public vehicle request.
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";

const schema = z.object({
  requestStatus: z.enum([
    "new",
    "sent_to_dealers",
    "offers_in",
    "sent_to_buyer",
    "buyer_interested",
    "closed",
    "lost",
  ]),
});

interface Params { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Params) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Admin session required", 401);

  const { id } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const notif = await prisma.notification.findUnique({ where: { id } });
  if (!notif || !notif.title?.startsWith("Vehicle Request:")) {
    return adminError("NOT_FOUND", "Vehicle request not found", 404);
  }

  const meta = (notif.metadata ?? {}) as Record<string, unknown>;
  const updated = { ...meta, requestStatus: parsed.data.requestStatus };

  await prisma.notification.update({
    where: { id },
    data: { metadata: updated as Parameters<typeof prisma.notification.update>[0]["data"]["metadata"] },
  });

  return adminSuccess({ id, requestStatus: parsed.data.requestStatus });
}
