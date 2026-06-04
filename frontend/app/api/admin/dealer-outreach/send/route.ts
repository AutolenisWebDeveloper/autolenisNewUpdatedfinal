// POST /api/admin/dealer-outreach/send — Phase 4B-3 single dealer email send.
import { NextRequest } from "next/server"
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api"
import {
  sendDealerEmail,
  type OutreachType,
} from "@/lib/services/dealer-recruitment/dealer-email-send.service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

const VALID_TYPES: OutreachType[] = ["initial", "followup_1", "followup_2"]

interface Body {
  dealerProspectId?: string
  outreachType?: string
  customSubject?: string
  customBody?: string
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

  const outreachType =
    body.outreachType && VALID_TYPES.includes(body.outreachType as OutreachType)
      ? (body.outreachType as OutreachType)
      : "initial"

  try {
    const result = await sendDealerEmail({
      dealerProspectId: body.dealerProspectId,
      outreachType,
      customSubject: body.customSubject,
      customBody: body.customBody,
    })
    if (!result.success) {
      return adminError("SEND_FAILED", result.error ?? "Send failed", 502)
    }
    return adminSuccess(result)
  } catch (err) {
    return adminError(
      "SEND_FAILED",
      err instanceof Error ? err.message : "Send failed",
      500,
    )
  }
}
