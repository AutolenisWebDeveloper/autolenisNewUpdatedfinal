// POST /api/admin/dealer-outreach/pause-sequence — Phase 4B-4.
// Manually stop (or record a reply on) a dealer's follow-up cadence.
import { NextRequest } from "next/server"
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api"
import {
  pauseSequence,
  type SequencePauseReason,
} from "@/lib/services/dealer-recruitment/dealer-followup.service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const VALID_REASONS: SequencePauseReason[] = [
  "bounced",
  "opted_out",
  "replied",
  "manual",
]

interface Body {
  dealerProspectId?: string
  reason?: string
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

  if (!body.dealerProspectId) {
    return adminError("MISSING_ID", "dealerProspectId is required", 400)
  }

  const reason: SequencePauseReason =
    body.reason && VALID_REASONS.includes(body.reason as SequencePauseReason)
      ? (body.reason as SequencePauseReason)
      : "manual"

  try {
    await pauseSequence(body.dealerProspectId, reason)
    return adminSuccess({ paused: true, reason })
  } catch (err) {
    return adminError(
      "PAUSE_FAILED",
      err instanceof Error ? err.message : "Pause failed",
      500,
    )
  }
}
