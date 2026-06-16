// POST /api/admin/dealer-outreach/run-followups — Phase 4B-4.
// Admin-triggered run of the follow-up sequence (same logic as the cron) so the
// founder can fire it on demand without exposing CRON_SECRET to the browser.
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server"
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api"
import {
  findDealersDueForFollowup,
  sendFollowUp,
} from "@/lib/services/dealer-recruitment/dealer-followup.service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request)
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401)

  try {
    const due = await findDealersDueForFollowup()
    logger.info(`[phase-4b4] Manual run. ${due.length} dealers due for follow-up.`)

    let sent = 0
    let failed = 0
    for (const dealer of due) {
      try {
        await sendFollowUp(dealer.id)
        sent++
        await new Promise((r) => setTimeout(r, 1000))
      } catch (err) {
        failed++
        logger.error(
          `[phase-4b4] Manual follow-up failed for ${dealer.id}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    return adminSuccess({ due: due.length, sent, failed })
  } catch (err) {
    return adminError(
      "RUN_FAILED",
      err instanceof Error ? err.message : "Run failed",
      500,
    )
  }
}
