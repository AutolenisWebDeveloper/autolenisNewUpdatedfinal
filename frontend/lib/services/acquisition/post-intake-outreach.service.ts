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
import { collapseByInbox } from "@/lib/services/dealer-recruitment/shared-inbox"
import { isFulfillmentUnlocked } from "@/lib/services/payment/fulfillment-gate"

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

// Execution status of the outreach stage, so the intake pipeline can tell apart:
//   SUCCESS       — at least one dealer contacted.
//   ZERO_RESULTS  — ran fine, nobody CONTACTABLE (no eligible prospects, or every
//                   candidate is permanently unreachable — suppressed / undeliverable).
//                   A valid completion; retrying would not help.
//   SKIPPED       — nothing to do (no make/vehicle info).
//   DEFERRED      — a TRANSIENT throttle (channel rate limit) blocked every send.
//                   NOT a failure: the intake must retry later WITHOUT counting
//                   toward the terminal cap (the limit self-clears).
//   FAILED        — an EXECUTION failure (infra error, or a genuine send error on
//                   every eligible prospect). Blocks completion; bounded retry.
// The dealer-sourcing spine is REQUIRED for a valid terminal intake, so this
// distinction decides whether intake may complete, defer, or fail.
export type OutreachStatus = "SUCCESS" | "ZERO_RESULTS" | "SKIPPED" | "DEFERRED" | "FAILED"

export interface PostIntakeOutreachResult {
  dealersContacted: number
  status: OutreachStatus
  /** Sanitized reason, set on DEFERRED / FAILED. */
  reason?: string
}

/**
 * Run the post-intake dealer outreach for a single BuyerOpportunity. Returns the
 * number of dealers contacted plus an execution status (see OutreachStatus).
 * Never throws.
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
      // The pipeline already loaded this opportunity; a miss here is an anomaly,
      // not a valid empty result — surface it as an execution failure.
      return { dealersContacted: 0, status: "FAILED", reason: "opportunity not found during outreach" }
    }

    // Vehicle-specific outreach requires at least a make.
    if (!opportunity.make) {
      logger.info(
        `[post-intake-outreach] Opportunity ${buyerOpportunityId} has no make — skipping outreach`,
      )
      return { dealersContacted: 0, status: "SKIPPED" }
    }

    // $99 PRE-ACTIVATION COST GATE (Section 5): dealer outreach is cost-bearing,
    // dealer-facing fulfillment and must NOT fire before an authoritative PAID
    // $99 deposit. Discovery (cost-free, data AutoLenis already owns) has already
    // run in an earlier stage; this stops the progression into outreach. SKIPPED
    // (not FAILED) is a valid terminal stage, so intake still completes — no
    // dealer is contacted for a buyer who has not paid. Program 3 owns paid dealer
    // supply/targeting/outreach after the boundary is crossed.
    if (!(await isFulfillmentUnlocked(opportunity.buyerId))) {
      logger.info(
        `[post-intake-outreach] Opportunity ${buyerOpportunityId} has no PAID $99 deposit — outreach gated (awaiting_deposit)`,
      )
      return { dealersContacted: 0, status: "SKIPPED", reason: "awaiting_deposit_gate" }
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
    const prospectRows = await prisma.dealerProspect.findMany({
      where: {
        buyerOppId: opportunity.id,
        email: { not: null },
        status: { notIn: ["DEAD", "ONBOARDED"] },
        outreachLog: {
          none: { status: { in: ["queued", "sent", "delivered"] } },
        },
      },
      orderBy: [{ distanceMiles: "asc" }, { searchScore: "desc" }],
      // Over-fetch so shared-inbox collapse (below) doesn't shrink the send set
      // below MAX_DEALERS when several top prospects share one mailbox — collapse
      // first, THEN cap to MAX_DEALERS distinct mailboxes.
      take: MAX_DEALERS * 4,
      select: {
        id: true,
        name: true,
        contactName: true,
        email: true,
        city: true,
        state: true,
      },
    })

    // Send-path shared-inbox collapse: multiple prospects that resolved to the
    // SAME mailbox (e.g. a shared internetsales@ role inbox on a group domain)
    // get ONE outreach, not duplicate sends to the same inbox. Ordering is
    // preserved, so the best-ranked prospect for a mailbox is the one kept.
    // Collapse THEN cap to MAX_DEALERS distinct mailboxes. (Coverage still counts
    // distinct rooftops — collapse is a send-path concern, never the coverage count.)
    const prospects = collapseByInbox(prospectRows, (p) => p.email).slice(0, MAX_DEALERS)

    if (prospects.length === 0) {
      logger.info(
        `[post-intake-outreach] No eligible dealers for buyer opportunity ${buyerOpportunityId}`,
      )
      // Ran fine, nothing to contact — a valid business outcome, not a failure.
      return { dealersContacted: 0, status: "ZERO_RESULTS" }
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
    let sendsAttempted = 0
    // Classify why sends did NOT land, so a transient throttle and permanently
    // unreachable dealers are not mistaken for an execution failure. Permanent
    // reasons (suppressed / undeliverable / already-contacted / no-email) need no
    // counter — they simply fall through to the ZERO_RESULTS default below.
    let transientCount = 0 // rate_limited / not_configured → defer, retry later
    let errorCount = 0 // genuine send error (or unknown reason) → execution failure
    for (const prospect of prospects) {
      if (!prospect.email) continue
      sendsAttempted += 1

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
          if (result.reason === "rate_limited" || result.reason === "not_configured") {
            transientCount += 1
          } else if (
            result.reason === "suppressed" ||
            result.reason === "undeliverable" ||
            result.reason === "already_contacted" ||
            result.reason === "no_email"
          ) {
            // Permanent — dealer is unreachable; no counter (falls through to ZERO_RESULTS).
          } else {
            errorCount += 1 // send_error / not_found / unknown reason → genuine failure
          }
        }
      } catch (err) {
        logger.error(
          `[post-intake-outreach] Send threw for dealer ${prospect.id}:`,
          err,
        )
        errorCount += 1
      }

      // Small delay between sends to respect channel rate limits.
      await delay(SEND_DELAY_MS)
    }

    logger.info(
      `[post-intake-outreach] Contacted ${dealersContacted} dealers for buyer opportunity ${buyerOpportunityId}`,
    )
    // Eligible prospects existed but NONE were contacted. Classify by why, so a
    // self-clearing throttle or permanently-unreachable dealers do not masquerade
    // as an execution failure (which would burn the bounded-retry budget and
    // dead-letter a recoverable intake):
    //   • any GENUINE send error  → FAILED   (execution failure; bounded retry).
    //   • else any RATE-LIMIT      → DEFERRED (retry later; does NOT count to cap).
    //   • else all PERMANENT       → ZERO_RESULTS (uncontactable dealers; complete).
    if (dealersContacted === 0 && sendsAttempted > 0) {
      if (errorCount > 0) {
        return {
          dealersContacted: 0,
          status: "FAILED",
          reason: `${errorCount} of ${sendsAttempted} dealer send(s) errored`,
        }
      }
      if (transientCount > 0) {
        return {
          dealersContacted: 0,
          status: "DEFERRED",
          reason: `${transientCount} of ${sendsAttempted} send(s) throttled — retry later`,
        }
      }
      // All permanent (suppressed / undeliverable): these dealers are unreachable;
      // retrying will not help, so this is a valid zero-result completion.
      return { dealersContacted: 0, status: "ZERO_RESULTS" }
    }
    return { dealersContacted, status: "SUCCESS" }
  } catch (err) {
    logger.error(
      `[post-intake-outreach] Outreach failed for buyer opportunity ${buyerOpportunityId}:`,
      err,
    )
    const reason = err instanceof Error ? err.message : String(err)
    return { dealersContacted: 0, status: "FAILED", reason }
  }
}
