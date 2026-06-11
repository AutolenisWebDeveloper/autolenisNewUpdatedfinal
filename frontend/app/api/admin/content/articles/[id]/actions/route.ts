// Phase 3 — single-article workflow actions.
//
// POST /api/admin/content/articles/[id]/actions  { action, ... }
//   validate | override_validation | approve | schedule | publish_now |
//   unpublish | rollback | archive | restore
//
// Each action is gated by the corresponding content capability (WO-13), runs the
// matching service, and writes an audit log. Override requires a reason.

import { NextRequest } from "next/server";
import { z } from "zod";
import { adminError, adminSuccess, createAuditLog, getAdminFromRequest } from "@/lib/auth/admin-api";
import { hasContentCapability, type ContentCapability } from "@/lib/auth/content-permissions";
import { prisma } from "@/lib/prisma";
import { validateArticle } from "@/lib/services/content/content-validation.service";
import {
  approveArticle,
  publishNow,
  schedule,
  unpublish,
  rollback,
} from "@/lib/services/content/content-publishing.service";
import { recordWorkflowEvent } from "@/lib/services/content/content-workflow";

const schema = z.object({
  action: z.enum([
    "validate",
    "override_validation",
    "approve",
    "schedule",
    "publish_now",
    "unpublish",
    "rollback",
    "archive",
    "restore",
  ]),
  scheduledAt: z.string().datetime().optional(),
  versionNumber: z.number().int().positive().optional(),
  reason: z.string().min(3).optional(),
});

const ACTION_CAPABILITY: Record<z.infer<typeof schema>["action"], ContentCapability> = {
  validate: "content.edit",
  override_validation: "content.override_validation",
  approve: "content.approve",
  schedule: "content.schedule",
  publish_now: "content.publish",
  unpublish: "content.publish",
  rollback: "content.edit",
  archive: "content.archive",
  restore: "content.edit",
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.message, 400);
  const { action, scheduledAt, versionNumber, reason } = parsed.data;

  const cap = ACTION_CAPABILITY[action];
  if (!hasContentCapability(admin.role, cap)) {
    return adminError("FORBIDDEN", `Missing ${cap} capability`, 403);
  }

  const actor = admin.email;

  try {
    let data: unknown;
    switch (action) {
      case "validate": {
        const { run } = await validateArticle(id);
        data = { passed: run.passed, requiresHumanReview: run.requiresHumanReview, layers: run.layers };
        break;
      }
      case "override_validation": {
        if (!reason) return adminError("VALIDATION_ERROR", "Override requires a reason", 400);
        const { run } = await validateArticle(id, {
          overriddenByAdminId: admin.adminId,
          overrideReason: reason,
        });
        await recordWorkflowEvent({
          articleId: id,
          eventType: "validation.override",
          actor,
          payload: { reason },
        });
        data = { passed: true, overridden: true, layers: run.layers };
        break;
      }
      case "approve":
        data = await approveArticle(id, admin.adminId);
        break;
      case "schedule": {
        if (!scheduledAt) return adminError("VALIDATION_ERROR", "schedule requires scheduledAt", 400);
        data = await schedule(id, new Date(scheduledAt), actor);
        break;
      }
      case "publish_now":
        data = await publishNow(id, actor);
        break;
      case "unpublish":
        data = await unpublish(id, actor);
        break;
      case "rollback": {
        if (!versionNumber) return adminError("VALIDATION_ERROR", "rollback requires versionNumber", 400);
        data = await rollback(id, versionNumber, actor);
        break;
      }
      case "archive":
        data = await prisma.contentArticle.update({ where: { id }, data: { status: "ARCHIVED" } });
        await recordWorkflowEvent({ articleId: id, eventType: "article.archive", actor });
        break;
      case "restore":
        data = await prisma.contentArticle.update({ where: { id }, data: { status: "DRAFT" } });
        await recordWorkflowEvent({ articleId: id, eventType: "article.restore", actor });
        break;
    }

    await createAuditLog(admin, request, {
      action: `CONTENT_ARTICLE_${action.toUpperCase()}`,
      entityType: "ContentArticle",
      entityId: id,
      reason,
      metadata: { action, scheduledAt, versionNumber },
    });

    return adminSuccess({ action, result: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return adminError("ACTION_FAILED", message, 422);
  }
}
