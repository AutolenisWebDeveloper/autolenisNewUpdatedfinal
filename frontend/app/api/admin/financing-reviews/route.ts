// GET /api/admin/financing-reviews — list open financing review tasks (stips,
// adverse-action, edge declines, lender failures) for the human-in-the-loop queue.
import { NextRequest } from "next/server";
import { getAdminWithRole, adminError, adminSuccess, OPERATIONAL_ROLES } from "@/lib/auth/admin-api";
import { listOpenReviewTasks } from "@/lib/services/financing/review-queue.service";

export async function GET(request: NextRequest) {
  const admin = await getAdminWithRole(request, OPERATIONAL_ROLES);
  if (!admin) return adminError("FORBIDDEN", "Finance/operations/compliance admin required", 403);
  const tasks = await listOpenReviewTasks(200);
  return adminSuccess({ tasks });
}
