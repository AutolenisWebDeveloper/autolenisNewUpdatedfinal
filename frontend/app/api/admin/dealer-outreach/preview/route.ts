// POST /api/admin/dealer-outreach/preview — generate an outreach email without
// sending it. Body: { dealerProspectId }. Returns { subject, body, bodyText }.
import { NextRequest } from "next/server"
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api"
import { prisma } from "@/lib/prisma"
import { generateEmailTemplate } from "@/lib/services/dealer-recruitment/email-template.service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request)
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401)

  let body: { dealerProspectId?: string }
  try {
    body = await request.json()
  } catch {
    return adminError("BAD_REQUEST", "Invalid JSON body", 400)
  }
  if (!body.dealerProspectId) {
    return adminError("BAD_REQUEST", "dealerProspectId is required", 400)
  }

  const prospect = await prisma.dealerProspect.findUnique({
    where: { id: body.dealerProspectId },
    include: { buyerOpp: true },
  })
  if (!prospect) return adminError("NOT_FOUND", "Prospect not found", 404)

  try {
    const opp = prospect.buyerOpp
    const template = await generateEmailTemplate({
      dealerName: prospect.name,
      contactName: null,
      contactTitle: null,
      city: prospect.city ?? "",
      state: prospect.state ?? "",
      topVehicleRequests:
        opp?.make || opp?.model
          ? [{ make: opp.make ?? "", model: opp.model ?? "", budget: opp.budgetAmount ?? null }]
          : undefined,
    })
    return adminSuccess({
      subject: template.subject,
      body: template.bodyText,
      html: template.body,
    })
  } catch (err) {
    return adminError(
      "PREVIEW_FAILED",
      err instanceof Error ? err.message : "Preview generation failed",
      500,
    )
  }
}
