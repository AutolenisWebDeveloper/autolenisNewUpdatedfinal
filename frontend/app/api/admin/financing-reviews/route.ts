// GET /api/admin/financing-reviews — open financing follow-ups for the human-in-the-loop queue.
//
// RE-POINTED IN PHASE 7 (§13-D25), NOT RETIRED. This route used to list `financing_review_tasks`:
// adverse-action reviews, lender failures, stips and edge declines — every one of them a state of
// the in-house lender decisioning §12 says AutoLenis never performs. Those task types could only
// ever be produced by `financing-orchestrator.service.ts`, which had zero production callers and
// is deleted in this phase.
//
// The CAPABILITY is kept: an operational admin still gets a list of financing matters awaiting a
// human decision, and still resolves each with a recorded note. It now reads `queue_items`, the
// §26 exception register, so there is one queue rather than two — and the rows in it are produced
// by something that actually runs (`recordFinancingCheckpoint`'s FAILED/EXPIRED branch).
//
// The URL, the role gate and the response envelope are unchanged so no admin surface breaks; the
// `tasks` key is kept for the same reason and now carries follow-ups.
import { NextRequest } from "next/server";
import { getAdminWithRole, adminError, adminSuccess, OPERATIONAL_ROLES } from "@/lib/auth/admin-api";
import { listOpenFinancingFollowUps } from "@/lib/services/financing/financing-follow-up.service";

export async function GET(request: NextRequest) {
  const admin = await getAdminWithRole(request, OPERATIONAL_ROLES);
  if (!admin) return adminError("FORBIDDEN", "Finance/operations/compliance admin required", 403);
  const tasks = await listOpenFinancingFollowUps(200);
  return adminSuccess({ tasks });
}
