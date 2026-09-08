// GET /api/admin/dealer-outreach/coverage — dealer contact-coverage census.
//
// Read-only ops readout: how much of the Dealer / DealerRooftop / DealerProspect
// population actually has a send-safe contact, what the backfill (B′) would
// process next, and the current Apollo cycle budget. Counts only — no writes, no
// Apollo calls, no credit spend. Admin + MFA enforced server-side
// (getAdminFromRequest rejects a token without mfaVerified).
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { getContactCoverage } from "@/lib/services/dealer-recruitment/contact-coverage.service";
<<<<<<< HEAD
import { getApolloPipelineCounters } from "@/lib/services/dealer-recruitment/apollo-orchestration.service";
=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  try {
<<<<<<< HEAD
    // Both are pure counts. Read together so the HTTP readout carries the same
    // figures the coverage page shows.
    const [coverage, apolloPipeline] = await Promise.all([
      getContactCoverage(),
      getApolloPipelineCounters(),
    ]);
    return adminSuccess({ ...coverage, apolloPipeline });
=======
    return adminSuccess(await getContactCoverage());
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  } catch (err) {
    return adminError(
      "FETCH_FAILED",
      err instanceof Error ? err.message : "Failed to fetch contact coverage",
      500,
    );
  }
}
