// POST /api/admin/social/connections/buffer-test
// Live Buffer connection check for the Settings tab. Unlike GET /connections
// (which only reports env-var presence), this makes a real authenticated Buffer
// GraphQL call: it validates BUFFER_API_KEY, lists the connected channels, and
// cross-references each configured BUFFER_PROFILE_* id against the real channels
// so a missing/stale id is surfaced. Read-only — it never creates a post.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { verifyBufferConnection } from "@/lib/social/providers/buffer.provider";

// The external Buffer round-trip can take a couple of seconds.
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const result = await verifyBufferConnection();
  return adminSuccess(result);
}
