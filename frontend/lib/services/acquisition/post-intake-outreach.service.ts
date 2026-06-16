// lib/services/acquisition/post-intake-outreach.service.ts
//
// Post-intake automatic dealer outreach. Runs in the background (via a Vercel
// after() hook registered in each intake API route) once a BuyerOpportunity has
// been created. It finds the dealer prospects discovered for that opportunity
// and sends each one a vehicle-specific, CAN-SPAM-compliant outreach email
// inviting them to submit an offer.
//
// PRIVACY (non-negotiable): dealer emails carry ONLY non-identifying buyer
// signal — vehicle interest, a budget RANGE rounded to the nearest $5,000
// bracket, city + state (never the zip), timeline and condition. No buyer name,
// email, phone, address, or exact budget is ever sent to a dealer.
//
// This service NEVER throws — every failure is logged and degraded so a buyer's
// intake response is never affected by outreach problems.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma"
import { generateBuyerOpportunityEmail } from "@/lib/services/dealer-recruitment/email-template.service"
import { sendDealerEmail } from "@/lib/services/dealer-recruitment/dealer-email-send.service"

const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autolenis.com"
).trim()

// Max dealers contacted per opportunity in a single outreach pass.
const MAX_DEALERS = 8
// Delay between sends to stay well under the email channel rate limits.
const SEND_DELAY_MS = 500

/**
 * Round an exact budget (in cents) down to its $5,000 bracket and return the
 * bracket as a display range. Spec-exact.
 *   $32,500 → "$30,000-$35,000"
 *   $28,000 → "$25,000-$30,000"
 */
export function getBudgetRange(exactBudgetCents: number): string {
  const dollars = exactBudgetCents / 100
  const lower = Math.floor(dollars / 5000) * 5000
  const upper = lower + 5000
  return `$${lower.toLocaleString()}-$${upper.toLocaleString()}`
}

// Build a human year range from the opportunity's min/max.
function buildYearRange(
  yearMin: number | null,
  yearMax: number | null,
): string {
  if (yearMin && yearMax) {
    return yearMin === yearMax ? `${yearMin}` : `${yearMin}-${yearMax}`
  }
  if (yearMin) return `${yearMin}`
  if (yearMax) return `${yearMax}`
  return ""
}

// Map the opportunity's vehicleType onto a buyer-facing condition label.
// vehicleType carries the condition (new/used/open/either) on some entry
// points and a body style on others — fall back to "Either" when it isn't a
// recognized condition.
function deriveCondition(vehicleType: string | null): string {
  const v = (vehicleType ?? "").toLowerCase().trim()
  if (v === "new") return "New"
  if (v === "used") return "Used"
  if (v === "open" || v === "either") return "Either"
  return "Either"
}

// Humanize the stored timeline token for the dealer-facing email.
function humanizeTimeline(timeline: string | null): string {
  const t = (timeline ?? "").toLowerCase().trim()
  if (!t) return "flexible"
  if (t === "asap" || t.includes("asap")) return "as soon as possible"
  if (t === "this_week" || t.includes("week")) return "within 7 days"
  if (t === "1_month" || t.includes("30")) return "within 30 days"
  if (t === "1_to_3_months" || t.includes("60") || t.includes("month")) {
    return "within 1-3 months"
  }
  if (t === "researching" || t.includes("research")) return "just researching"
  return timeline ?? "flexible"
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface PostIntakeOutreachResult {
  dealersContacted: number
}

/**
 * Run the post-intake dealer outreach for a single BuyerOpportunity. Returns the
 * number of dealers successfully contacted (0 on any error).
 */
export async function runPostIntakeOutreach(
  buyerOpportunityId: string,
): Promise<PostIntakeOutreachResult> {
  try {
    // 1. Load the opportunity.
    const opportunity = await prisma.buyerOpportunity.findUnique({
      where: { id: buyerOpportunityId },
      select: {
        id: true,
        buyerId: true,
        make: true,
        model: true,
        yearMin: true,
        yearMax: true,
        budgetAmount: true, // stored in DOLLARS on BuyerOpportunity
        vehicleType: true,
        timeline: true,
        zip: true,
      },
    })

    if (!opportunity) {
      logger.warn(
        `[post-intake-outreach] BuyerOpportunity ${buyerOpportunityId} not found`,
      )
      return { dealersContacted: 0 }
    }

    // Vehicle-specific outreach requires at least a make.
    if (!opportunity.make) {
      logger.info(
        `[post-intake-outreach] Opportunity ${buyerOpportunityId} has no make — skipping outreach`,
      )
      return { dealersContacted: 0 }
    }

    // 2. Resolve the buyer's city/state for the dealer-facing location. The
    //    opportunity itself only carries a zip (never sent to dealers), so we
    //    prefer the resolved buyer's city/state. We fall back to a discovered
    //    dealer's city/state below if the buyer has none.
    let buyerCity = ""
    let buyerState = ""
    if (opportunity.buyerId) {
      const buyer = await prisma.buyer.findUnique({
        where: { id: opportunity.buyerId },
        select: { city: true, state: true },
      })
      buyerCity = buyer?.city ?? ""
      buyerState = buyer?.state ?? ""
    }

    // 3. Find up to MAX_DEALERS eligible prospects for THIS opportunity:
    //    - has a non-empty email
    //    - not DEAD / ONBOARDED
    //    - not already contacted (no queued/sent/delivered outreach log row).
    //      DealerProspect is scoped to a single opportunity (buyerOppId), so a
    //      prior log on the prospect == already contacted for this opportunity.
    const prospects = await prisma.dealerProspect.findMany({
      where: {
        buyerOppId: opportunity.id,
        email: { not: null },
        status: { notIn: ["DEAD", "ONBOARDED"] },
        outreachLog: {
          none: { status: { in: ["queued", "sent", "delivered"] } },
        },
      },
      orderBy: [{ distanceMiles: "asc" }, { searchScore: "desc" }],
      take: MAX_DEALERS,
      select: {
        id: true,
        name: true,
        contactName: true,
        email: true,
        city: true,
        state: true,
      },
    })

    if (prospects.length === 0) {
      logger.info(
        `[post-intake-outreach] No eligible dealers for buyer opportunity ${buyerOpportunityId}`,
      )
      return { dealersContacted: 0 }
    }

    // 4. Precompute the shared, privacy-safe vehicle/budget signal.
    const yearRange = buildYearRange(opportunity.yearMin, opportunity.yearMax)
    const budgetRange =
      opportunity.budgetAmount != null
        ? // budgetAmount is dollars on BuyerOpportunity; getBudgetRange wants cents.
          getBudgetRange(opportunity.budgetAmount * 100)
        : "Flexible"
    const condition = deriveCondition(opportunity.vehicleType)
    const timeline = humanizeTimeline(opportunity.timeline)
    const offerSubmitUrl = `${APP_URL}/dealer/opportunities`

    // 5. Send to each dealer, counting successes. Per-dealer failures never stop
    //    the loop. sendDealerEmail handles suppression, rate limiting, and the
    //    DealerOutreachLog record for us.
    let dealersContacted = 0
    for (const prospect of prospects) {
      if (!prospect.email) continue

      // Prefer the buyer's city/state; fall back to this dealer's area (the
      // discovery was run around the buyer's zip, so prospects share the metro)
      // so we never leak the zip while still grounding the location.
      const city = buyerCity || prospect.city || ""
      const state = buyerState || prospect.state || ""

      try {
        const template = generateBuyerOpportunityEmail({
          dealerName: prospect.name,
          dealerContactName: prospect.contactName,
          vehicleMake: opportunity.make,
          vehicleModel: opportunity.model ?? "",
          yearRange,
          budgetRange,
          buyerCity: city,
          buyerState: state,
          timeline,
          condition,
          offerSubmitUrl,
        })

        const result = await sendDealerEmail({
          dealerProspectId: prospect.id,
          outreachType: "initial",
          prebuiltTemplate: template,
        })

        if (result.success) {
          dealersContacted += 1
        } else {
          logger.warn(
            `[post-intake-outreach] Send to dealer ${prospect.id} failed: ${result.error}`,
          )
        }
      } catch (err) {
        logger.error(
          `[post-intake-outreach] Send threw for dealer ${prospect.id}:`,
          err,
        )
      }

      // Small delay between sends to respect channel rate limits.
      await delay(SEND_DELAY_MS)
    }

    logger.info(
      `[post-intake-outreach] Contacted ${dealersContacted} dealers for buyer opportunity ${buyerOpportunityId}`,
    )
    return { dealersContacted }
  } catch (err) {
    logger.error(
      `[post-intake-outreach] Outreach failed for buyer opportunity ${buyerOpportunityId}:`,
      err,
    )
    return { dealersContacted: 0 }
  }
}
