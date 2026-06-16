// AutoLenis Phase 4B-4 — Dealer follow-up cron.
//
// Runs each weekday morning. Finds dealer prospects due for their next
// follow-up touch and sends it, spacing sends ~1s apart to stay polite to the
// Resend channel (the send service also enforces the platform rate limits).
//
// Auth: Vercel cron (x-vercel-cron header) OR a Bearer CRON_SECRET, matching
// the convention used by the other /api/cron/* routes.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server"
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants"
import {
  findDealersDueForFollowup,
  sendFollowUp,
} from "@/lib/services/dealer-recruitment/dealer-followup.service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER)
  const isVercelCron = request.headers.get("x-vercel-cron") === "1"
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

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
  return NextResponse.json({ due: due.length, sent, failed })
}
