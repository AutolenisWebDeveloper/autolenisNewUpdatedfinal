// POST /api/admin/dealer-outreach/preview — Phase 4B-3 email preview (no send).
import { NextRequest } from "next/server"
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api"
import { previewDealerEmail } from "@/lib/services/dealer-recruitment/dealer-email-send.service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

interface Body {
  dealerProspectId?: string
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

  try {
    const preview = await previewDealerEmail(body.dealerProspectId)
    if (!preview) return adminError("NOT_FOUND", "Prospect not found", 404)
    return adminSuccess(preview)
  } catch (err) {
    return adminError(
      "PREVIEW_FAILED",
      err instanceof Error ? err.message : "Preview failed",
      500,
    )
  }
}
