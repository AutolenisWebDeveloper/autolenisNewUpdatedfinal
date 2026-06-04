// POST /api/admin/dealer-outreach/send-batch — Phase 4B-3 batch dealer send.
// Queues a personalized email to each selected prospect with a 2s jitter
// between sends (deliverability) inside Vercel after(), so the request returns
// immediately with the queued count.
import { NextRequest } from "next/server"
import { after } from "next/server"
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api"
import {
  sendDealerEmail,
  type OutreachType,
} from "@/lib/services/dealer-recruitment/dealer-email-send.service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300

const VALID_TYPES: OutreachType[] = ["initial", "followup_1", "followup_2"]
const MAX_BATCH = 50
const JITTER_MS = 2000

interface Body {
  dealerProspectIds?: string[]
  outreachType?: string
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request)
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401)

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return adminError("INVALID_JSON", "Invalid JSON body", 400)
  }

  const ids = Array.isArray(body.dealerProspectIds)
    ? Array.from(new Set(body.dealerProspectIds.filter((s) => typeof s === "string")))
    : []
  if (ids.length === 0) {
    return adminError("MISSING_IDS", "dealerProspectIds[] is required", 400)
  }
  if (ids.length > MAX_BATCH) {
    return adminError("BATCH_TOO_LARGE", `Max ${MAX_BATCH} per batch`, 422)
  }

  const outreachType =
    body.outreachType && VALID_TYPES.includes(body.outreachType as OutreachType)
      ? (body.outreachType as OutreachType)
      : "initial"

  after(async () => {
    let sent = 0
    let failed = 0
    for (let i = 0; i < ids.length; i++) {
      try {
        const r = await sendDealerEmail({ dealerProspectId: ids[i], outreachType })
        if (r.success) sent++
        else failed++
      } catch (err) {
        failed++
        console.error(`[phase-4b3] Batch send threw for ${ids[i]}:`, err)
      }
      if (i < ids.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, JITTER_MS))
      }
    }
    console.log(
      `[phase-4b3] Batch finished — queued ${ids.length}, sent ${sent}, failed ${failed}`,
    )
  })

  return adminSuccess({
    queued: ids.length,
    message: `Queued ${ids.length} dealer email(s). Sending in the background.`,
  })
}
