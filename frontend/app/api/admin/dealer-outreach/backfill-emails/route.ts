// POST /api/admin/dealer-outreach/backfill-emails — Phase 4B-1 email backfill.
//
// Enriches dealer prospects with Internet Sales Manager emails via Gemini
// Search grounding. Optionally accepts a `dealerIds` filter; otherwise targets
// every prospect with no email yet.
//
// The actual Gemini calls run in Vercel after() (in batches of 5 concurrent) so
// the request returns immediately with the queued count — enrichment can take
// several seconds per dealer and we never want the admin's click to block.
// Per-dealer success/failure is logged with the [phase-4b1] tag (Vercel logs).
import { NextRequest } from "next/server"
import { after } from "next/server"
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api"
import { prisma } from "@/lib/prisma"
import { enrichDealerEmail } from "@/lib/services/dealer-recruitment/email-enrichment.service"
import { type Prisma } from "@prisma/client"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300

// How many prospects to queue per call, and how many to enrich concurrently.
const MAX_PROSPECTS = 50
const BATCH_SIZE = 5

interface BackfillBody {
  dealerIds?: string[]
  // When true, re-enrich even dealers that already have an email / were
  // enriched recently (bypasses the 30-day guard inside the service).
  force?: boolean
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request)
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401)

  let body: BackfillBody = {}
  try {
    // Body is optional — an empty POST means "all prospects missing an email".
    const text = await request.text()
    if (text.trim()) body = JSON.parse(text) as BackfillBody
  } catch {
    return adminError("INVALID_JSON", "Invalid JSON body", 400)
  }

  const where: Prisma.DealerProspectWhereInput = {}
  if (Array.isArray(body.dealerIds) && body.dealerIds.length > 0) {
    where.id = { in: body.dealerIds }
    // Explicit id list ⇒ caller wants these enriched even if already populated.
  } else {
    // Default scope: prospects that still have no email.
    where.email = null
  }

  let prospects: Array<{
    id: string
    name: string
    city: string | null
    state: string | null
    website: string | null
  }>
  try {
    prospects = await prisma.dealerProspect.findMany({
      where,
      select: { id: true, name: true, city: true, state: true, website: true },
      orderBy: { createdAt: "asc" },
      take: MAX_PROSPECTS,
    })
  } catch (err) {
    return adminError(
      "BACKFILL_FAILED",
      err instanceof Error ? err.message : "Failed to load prospects",
      500,
    )
  }

  const force = body.force === true

  // Background enrichment — runs after the response is flushed.
  after(async () => {
    let succeeded = 0
    let failed = 0
    for (let i = 0; i < prospects.length; i += BATCH_SIZE) {
      const batch = prospects.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map((p) =>
          enrichDealerEmail({
            dealerProspectId: p.id,
            dealerName: p.name,
            city: p.city ?? "",
            state: p.state ?? "",
            website: p.website,
            force,
          }),
        ),
      )
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.email) succeeded++
        else if (r.status === "rejected") failed++
      }
    }
    console.log(
      `[phase-4b1] Backfill finished — attempted ${prospects.length}, captured ${succeeded}, errored ${failed}`,
    )
  })

  return adminSuccess({
    queued: prospects.length,
    message:
      prospects.length > 0
        ? `Queued ${prospects.length} dealer(s) for email enrichment. Results appear within a minute — refresh to see them.`
        : "No dealers needed enrichment.",
  })
}
