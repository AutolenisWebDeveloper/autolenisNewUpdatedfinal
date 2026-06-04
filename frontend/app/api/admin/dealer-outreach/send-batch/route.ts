// POST /api/admin/dealer-outreach/send-batch — queue outreach to many dealers.
// Body: { dealerProspectIds: string[], outreachType?: string }
// Sends fire in the background via Vercel after() with jitter between each so
// the request returns immediately and sends stay under spam-trigger velocity.
import { NextRequest } from "next/server"
import { after } from "next/server"
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api"
import { sendDealerEmail } from "@/lib/services/dealer-recruitment/dealer-email-send.service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300

type OutreachType = "initial" | "followup_1" | "followup_2"
const VALID_TYPES: OutreachType[] = ["initial", "followup_1", "followup_2"]
const MAX_BATCH = 50

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request)
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401)

  let body: { dealerProspectIds?: unknown; outreachType?: string }
  try {
    body = await request.json()
  } catch {
    return adminError("BAD_REQUEST", "Invalid JSON body", 400)
  }

  const ids = Array.isArray(body.dealerProspectIds)
    ? body.dealerProspectIds.filter((x): x is string => typeof x === "string" && x.length > 0)
    : []

  if (ids.length === 0) {
    return adminError("BAD_REQUEST", "dealerProspectIds must be a non-empty array", 400)
  }
  if (ids.length > MAX_BATCH) {
    return adminError("BAD_REQUEST", `Batch capped at ${MAX_BATCH} dealers per request`, 400)
  }

  const outreachType: OutreachType =
    body.outreachType && VALID_TYPES.includes(body.outreachType as OutreachType)
      ? (body.outreachType as OutreachType)
      : "initial"

  // De-dupe ids defensively.
  const uniqueIds = Array.from(new Set(ids))

  after(async () => {
    for (let i = 0; i < uniqueIds.length; i++) {
      const id = uniqueIds[i]
      try {
        const result = await sendDealerEmail({ dealerProspectId: id, outreachType })
        if (!result.success) {
          console.warn(`[phase-4b3] Batch send skipped/failed for ${id}: ${result.error}`)
        }
      } catch (err) {
        console.error(`[phase-4b3] Batch send threw for ${id}:`, err)
      }
      // 2s jitter between sends (skip after the last one).
      if (i < uniqueIds.length - 1) {
        const jitter = 2000 + Math.floor(Math.random() * 1000)
        await new Promise((resolve) => setTimeout(resolve, jitter))
      }
    }
  })

  return adminSuccess({ queued: uniqueIds.length })
}
