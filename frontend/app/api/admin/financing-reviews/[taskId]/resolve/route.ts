// POST /api/admin/financing-reviews/[taskId]/resolve — a human resolves a financing follow-up.
//
// RE-POINTED IN PHASE 7 (§13-D25). The previous handler resolved a `financing_review_tasks` row
// and could carry a `decision` that drove a `CreditApplication` through its own state machine,
// with an `override` flag to bypass the machine's validation. Both are gone with the machine: §12
// says AutoLenis "does not accept a lender application, does not pull lender credit, does not
// underwrite", so there is no application for an admin to decide and nothing to override.
//
// What remains is what §26 gives every exception: a resolution note, an actor, and a
// compare-and-set that refuses to record a resolution the database did not perform. That CAS is
// the reason this delegates to `resolve` in the queue-item service rather than writing the row
// here — `control/X-01` records the path this replaces, which caught the database error, returned
// as if the write had happened, and wrote an audit row saying "resolved".
import { NextRequest } from "next/server";
import { getAdminWithRole, adminError, adminSuccess, OPERATIONAL_ROLES } from "@/lib/auth/admin-api";
import { z } from "zod";
import { resolveFinancingFollowUp } from "@/lib/services/financing/financing-follow-up.service";

interface Props { params: Promise<{ taskId: string }> }

const schema = z.object({
  resolution: z.string().min(1, "A resolution note is required").max(2000),
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
    await resolveFinancingFollowUp({
      queueItemId: taskId,
      resolution: parsed.data.resolution,
      resolvedBy: admin.adminId,
    });
  } catch (e) {
    // Not found, or already resolved by someone else (the compare-and-set matched nothing).
    return adminError("RESOLVE_FAILED", e instanceof Error ? e.message : "Could not resolve the follow-up", 409);
  }

  return adminSuccess({ taskId, resolved: true });
}
