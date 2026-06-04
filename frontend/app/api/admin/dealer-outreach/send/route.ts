// POST /api/admin/dealer-outreach/send — send a single dealer outreach email.
// Body: { dealerProspectId, outreachType?, customSubject?, customBody? }
import { NextRequest } from "next/server"
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api"
import { sendDealerEmail } from "@/lib/services/dealer-recruitment/dealer-email-send.service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

type OutreachType = "initial" | "followup_1" | "followup_2"
const VALID_TYPES: OutreachType[] = ["initial", "followup_1", "followup_2"]

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request)
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401)

  let body: {
    dealerProspectId?: string
    outreachType?: string
    customSubject?: string
    customBody?: string
  }
  try {
    body = await request.json()
  } catch {
    return adminError("BAD_REQUEST", "Invalid JSON body", 400)
  }

  if (!body.dealerProspectId) {
    return adminError("BAD_REQUEST", "dealerProspectId is required", 400)
  }

  const outreachType: OutreachType =
    body.outreachType && VALID_TYPES.includes(body.outreachType as OutreachType)
      ? (body.outreachType as OutreachType)
      : "initial"

  // Both override fields must be present together, or neither.
  const hasSubject = typeof body.customSubject === "string" && body.customSubject.trim().length > 0
  const hasBody = typeof body.customBody === "string" && body.customBody.trim().length > 0
  if (hasSubject !== hasBody) {
    return adminError(
      "BAD_REQUEST",
      "customSubject and customBody must be provided together",
      400,
    )
  }

  try {
    const result = await sendDealerEmail({
      dealerProspectId: body.dealerProspectId,
      outreachType,
      customSubject: hasSubject ? body.customSubject : undefined,
      customBody: hasBody ? body.customBody : undefined,
    })

    if (!result.success) {
      return adminError("SEND_FAILED", result.error ?? "Email send failed", 502)
    }
    return adminSuccess(result)
  } catch (err) {
    return adminError(
      "SEND_FAILED",
      err instanceof Error ? err.message : "Email send failed",
      500,
    )
  }
}
