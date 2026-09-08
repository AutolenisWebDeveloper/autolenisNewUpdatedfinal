<<<<<<< HEAD
// POST /api/admin/queues/[queueType]/[itemId]/resolve
//
// control/X-01: `resolveQueueItem` used to swallow a failed database write and
// still record a QUEUE_ITEM_RESOLVED audit row, so this route answered
// `{ resolved: true }` for a resolution that never happened — the operator saw the
// item clear, the audit trail agreed, and the condition stayed live. The service
// now throws; this route reports the failure instead of asserting a success it
// did not observe.

=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { resolveQueueItem } from "@/lib/services/admin/admin-queue.service";
import type { QueueType } from "@/lib/services/admin/admin-queue.service";
<<<<<<< HEAD
import { QueueItemConcurrencyError } from "@/lib/services/operations/queue-item.service";
import { logger } from "@/lib/logger";
=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)

interface Props { params: Promise<{ queueType: string; itemId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { queueType, itemId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
<<<<<<< HEAD

  let body: { resolution?: string };
  try {
    body = (await request.json()) as { resolution?: string };
  } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const resolution = body.resolution;
  if (!resolution) return adminError("VALIDATION_ERROR", "resolution is required", 400);

  try {
    await resolveQueueItem(queueType as QueueType, itemId, admin.adminId, admin.email, resolution);
  } catch (err) {
    // A lost compare-and-swap is a 409, not a 500: someone else resolved it, or it
    // left the open set. The operator needs to know which — "already resolved" and
    // "the database is down" call for different next moves.
    if (err instanceof QueueItemConcurrencyError) {
      return adminError(
        "CONFLICT",
        "This item is no longer open — it was resolved or escalated by someone else. Refresh the queue.",
        409
      );
    }
    logger.error(`[admin/queues] resolve failed for ${queueType}/${itemId}:`, err);
    return adminError("RESOLVE_FAILED", "The resolution could not be recorded. Nothing was changed — try again.", 500);
  }

=======
  const { resolution } = await request.json() as { resolution: string };
  if (!resolution) return adminError("VALIDATION_ERROR", "resolution is required", 400);
  await resolveQueueItem(queueType as QueueType, itemId, admin.adminId, admin.email, resolution);
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  return adminSuccess({ resolved: true, itemId, queueType });
}
