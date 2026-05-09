import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { resolveQueueItem } from "@/lib/services/admin/admin-queue.service";
import type { QueueType } from "@/lib/services/admin/admin-queue.service";

interface Props { params: Promise<{ queueType: string; itemId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { queueType, itemId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const { resolution } = await request.json() as { resolution: string };
  if (!resolution) return adminError("VALIDATION_ERROR", "resolution is required", 400);
  await resolveQueueItem(queueType as QueueType, itemId, admin.adminId, admin.email, resolution);
  return adminSuccess({ resolved: true, itemId, queueType });
}
