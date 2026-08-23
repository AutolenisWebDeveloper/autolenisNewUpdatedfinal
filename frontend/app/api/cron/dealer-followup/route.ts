// AutoLenis Phase 4B-4 — Dealer follow-up cron.
//
// Runs each weekday morning. Finds dealer prospects due for their next
// follow-up touch and sends it, spacing sends ~1s apart to stay polite to the
// Resend channel (the send service also enforces the platform rate limits).
//
// Auth: requires `Authorization: Bearer ${CRON_SECRET}` via authorizeCronRequest
// (the shared cron-auth guard used by all /api/cron/* routes).

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server"
import {
  findDealersDueForFollowup,
  sendFollowUp,
} from "@/lib/services/dealer-recruitment/dealer-followup.service"
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("dealer-followup", async () => {
  const due = await findDealersDueForFollowup()
  logger.info(`[phase-4b4] Cron fired. ${due.length} dealers due for follow-up.`)

  let sent = 0
  let failed = 0

  for (const dealer of due) {
    try {
      await sendFollowUp(dealer.id)
      sent++
      // Polite 1s gap between sends.
      await new Promise((r) => setTimeout(r, 1000))
    } catch (err) {
      failed++
      logger.error(
        `[phase-4b4] Follow-up failed for ${dealer.id}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  logger.info(`[phase-4b4] Cron complete. sent=${sent} failed=${failed}`)
  return { due: due.length, sent, failed }
  })
  if (!run.ok) return NextResponse.json({ success: false, error: "dealer-followup_failed" }, { status: 500 })

  return NextResponse.json(run.result)
}
