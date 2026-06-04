// POST /api/admin/dealer-outreach/[prospectId]/reenrich-email — Phase 4B-1.
// Force re-runs Gemini Search email enrichment for a single prospect and
// returns the fresh result. Runs synchronously (one dealer) so the admin UI can
// reflect the captured email immediately.
import { NextRequest } from "next/server"
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api"
import { prisma } from "@/lib/prisma"
import { enrichDealerEmail } from "@/lib/services/dealer-recruitment/email-enrichment.service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

interface Params {
  params: Promise<{ prospectId: string }>
}

export async function POST(request: NextRequest, { params }: Params) {
  const admin = await getAdminFromRequest(request)
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401)

  const { prospectId } = await params

  const prospect = await prisma.dealerProspect.findUnique({
    where: { id: prospectId },
    select: { id: true, name: true, city: true, state: true, website: true },
  })
  if (!prospect) return adminError("NOT_FOUND", "Prospect not found", 404)

  try {
    const result = await enrichDealerEmail({
      dealerProspectId: prospect.id,
      dealerName: prospect.name,
      city: prospect.city ?? "",
      state: prospect.state ?? "",
      website: prospect.website,
      force: true, // manual re-enrich always bypasses the 30-day guard
    })

    const updated = await prisma.dealerProspect.findUnique({
      where: { id: prospectId },
      select: { email: true, emailSource: true, emailEnrichedAt: true },
    })

    return adminSuccess({
      result,
      email: updated?.email ?? null,
      emailSource: updated?.emailSource ?? null,
      emailEnrichedAt: updated?.emailEnrichedAt ?? null,
    })
  } catch (err) {
    return adminError(
      "ENRICH_FAILED",
      err instanceof Error ? err.message : "Email enrichment failed",
      500,
    )
  }
}
