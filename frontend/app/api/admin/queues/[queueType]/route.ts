import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { getQueueItems, getQueueCounts } from "@/lib/services/admin/admin-queue.service";
import type { QueueType } from "@/lib/services/admin/admin-queue.service";

interface Props { params: Promise<{ queueType: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { queueType } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const items = await getQueueItems(queueType as QueueType);
  return adminSuccess({ items, queueType });
}
