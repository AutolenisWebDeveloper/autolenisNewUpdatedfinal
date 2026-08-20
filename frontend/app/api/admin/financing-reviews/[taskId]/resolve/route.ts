// POST /api/admin/financing-reviews/[taskId]/resolve — a human resolves a financing
// review task. The decision (if any) is VALIDATED by the state machine unless the
// admin explicitly overrides; the resolution is recorded on the tamper-evident
// audit trail (HUMAN_OVERRIDE + REVIEW_RESOLVED).
import { NextRequest } from "next/server";
import { getAdminWithRole, adminError, adminSuccess, OPERATIONAL_ROLES } from "@/lib/auth/admin-api";
import { z } from "zod";
import { resolveReviewTask } from "@/lib/services/financing/review-queue.service";

interface Props { params: Promise<{ taskId: string }> }

const schema = z.object({
  resolution: z.string().min(1, "A resolution note is required").max(2000),
  // The safe set a human may drive an application to. No adverse-action content is
  // authored here — a DECLINED resolution still routes through the fail-closed notice
  // path if a rule is later injected.
  decision: z.enum(["APPROVED", "DECLINED", "CONDITIONAL", "WITHDRAWN", "HUMAN_REVIEW"]).optional(),
  override: z.boolean().optional(),
});

export async function POST(request: NextRequest, { params }: Props) {
  const admin = await getAdminWithRole(request, OPERATIONAL_ROLES);
  if (!admin) return adminError("FORBIDDEN", "Finance/operations/compliance admin required", 403);

  const { taskId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  try {
    await resolveReviewTask(taskId, {
      adminId: admin.adminId,
      resolution: parsed.data.resolution,
      decision: parsed.data.decision,
      override: parsed.data.override,
    });
  } catch (e) {
    // Not found, already resolved (CAS), or an illegal validated transition.
    return adminError("RESOLVE_FAILED", e instanceof Error ? e.message : "Could not resolve the task", 409);
  }

  return adminSuccess({ taskId, resolved: true });
}
