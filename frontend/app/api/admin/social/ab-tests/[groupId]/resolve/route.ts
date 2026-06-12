// POST /api/admin/social/ab-tests/[groupId]/resolve
// Manually scores and resolves a single A/B test group, promoting the winning
// hook variant and skipping the losers.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { groupId } = await params;

  const { scoreAndResolveGroup } = await import(
    "@/lib/social/hook-ab-testing.engine"
  );

  const result = await scoreAndResolveGroup(groupId);
  return adminSuccess(result);
}
