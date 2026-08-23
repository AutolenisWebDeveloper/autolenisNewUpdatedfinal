// Phase 3 — job control.
// POST /api/admin/content/jobs/[id]  { action: retry | cancel | pause | resume }
// Operates on ContentGenerationJob item statuses; the content-generation-drain
// cron picks up any items returned to QUEUED (no Inngest events involved).

import { NextRequest } from "next/server";
import { z } from "zod";
import { adminError, adminSuccess, createAuditLog } from "@/lib/auth/admin-api";
import { requireContentCapability } from "@/lib/auth/content-permissions";
import {
  cancelJob,
  pauseJob,
  resumeJob,
  retryFailedItems,
} from "@/lib/services/content/content-generation.service";

const schema = z.object({ action: z.enum(["retry", "cancel", "pause", "resume"]) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireContentCapability(request, "content.manage_jobs");
  if (!admin) return adminError("FORBIDDEN", "Missing content.manage_jobs capability", 403);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.message, 400);
  const { action } = parsed.data;
  const actor = admin.email;

  try {
    let result: unknown = { ok: true };
    switch (action) {
      case "retry":
        result = await retryFailedItems(id, actor);
        break;
      case "cancel":
        await cancelJob(id, actor);
        break;
      case "pause":
        await pauseJob(id, actor);
        break;
      case "resume":
        await resumeJob(id, actor);
        break;
    }
    await createAuditLog(admin, request, {
      action: `CONTENT_JOB_${action.toUpperCase()}`,
      entityType: "ContentGenerationJob",
      entityId: id,
      metadata: { action },
    });
    return adminSuccess({ action, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return adminError("ACTION_FAILED", message, 422);
  }
}
