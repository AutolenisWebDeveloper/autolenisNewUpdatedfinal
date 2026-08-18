// lib/services/acquisition/unified-buyer-intake.service.ts
//
// Group 5 — Unified buyer intake.
//
// Every buyer entry point (Zura widget, request-vehicle wizard, buyer
// dashboard, LP campaign forms, phone intake, voice dispatch) should funnel
// structured submissions through this single service so each one produces:
//   1. A BuyerOpportunity  (the AI-enrichment record)
//   2. A VehicleRequest    (the canonical buyer record, when a buyer can be
//                           resolved) linked back via buyerOpportunityId
// and then fires the Group 3 + 4A pipeline (market enrichment, dealer
// discovery, phone-script drafting, lead scoring, hot-lead notifications) in
// the background — mirroring the proven /api/concierge after() flow.
//
// Phase 5.1 builds this service only. Wiring the entry points to it happens in
// phases 5.2-5.4, so nothing here is invoked by existing routes yet.

import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";

export type IntakeSource =
  | "zura_widget"
  | "request_vehicle_wizard"
  | "buyer_dashboard"
  | "lp_campaign"
  | "phone_intake"
  | "voice_dispatch";

export interface UnifiedIntakeInput {
  source: IntakeSource;
  campaign?: string; // For lp_campaign, the campaign name

  // Buyer identification
  buyerId?: string; // If already resolved (dashboard flow)
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;

  // Vehicle interest
  make?: string;
  model?: string;
  vehicleType?: string;
  yearMin?: number;
  yearMax?: number;
  trim?: string;

  // Financial
  budgetAmount?: number; // in cents
  monthlyPayment?: number; // in cents

  // Timeline + location
  timeline?: string;
  zip?: string;

  // Trade-in
  hasTradeIn?: boolean;
  tradeInDetails?: Record<string, unknown>;

  // Financing
  financingNeeded?: boolean;

  // Existing VehicleRequest fields (for direct mapping)
  notes?: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  sourceUrl?: string | null;
  // Organic SEO attribution. `landingSource` is the semantic FormSource
  // ("seo_city_frisco", "seo_texas_hub", …) used to segment paid vs organic
  // conversions; `referrer` is document.referrer captured at form mount.
  landingSource?: string | null;
  referrer?: string | null;
}

export interface UnifiedIntakeResult {
  buyerOpportunityId: string;
  vehicleRequestId: string | null;
}

/**
 * Resolve a buyerId from the supplied input. Returns an already-resolved
 * buyerId verbatim, otherwise finds-or-creates a User + Buyer from the email
 * — the same three-case logic used by /api/public/request-vehicle.
 * Returns null when there is not enough information to resolve a buyer.
 */
async function resolveBuyerId(
  input: UnifiedIntakeInput,
): Promise<string | null> {
  if (input.buyerId) return input.buyerId;

  // Need at least an email + a first name to stand up a guest buyer.
  if (!input.email || !input.firstName) return null;

  const email = input.email.toLowerCase();
  const firstName = input.firstName;
  const lastName = input.lastName ?? "";

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email },
      include: { buyer: { select: { id: true } } },
    });

    if (existingUser?.buyer) {
      // Case 1: Registered buyer — link directly.
      return existingUser.buyer.id;
    }

    if (existingUser && !existingUser.buyer) {
      // Case 2: User exists but no buyer profile — create it.
      const newBuyer = await prisma.buyer.create({
        data: {
          userId: existingUser.id,
          firstName,
          lastName,
          phone: input.phone ?? null,
          zip: input.zip ?? null,
        },
      });
      return newBuyer.id;
    }

    // Case 3: No user at all — create guest User + Buyer.
    // User.supabaseId is NOT NULL — use a placeholder replaced at signup.
    const guestUser = await prisma.user.create({
      data: {
        supabaseId: `guest_${crypto.randomUUID()}`,
        email,
        role: "BUYER",
      },
    });
    const guestBuyer = await prisma.buyer.create({
      data: {
        userId: guestUser.id,
        firstName,
        lastName,
        phone: input.phone ?? null,
        zip: input.zip ?? null,
        isGuest: true,
      },
    });
    return guestBuyer.id;
  } catch (err) {
    logger.error("[unified-intake] buyer find/create failed:", err);
    return null;
  }
}

// Prisma raises P2022 ("column does not exist") when code references a column
// the database has not migrated yet. The add_landing_source_referrer migration
// may be unapplied in some environments, so we detect this case to retry the
// VehicleRequest create without the new columns rather than lose the lead.
function isMissingColumnError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2022"
  );
}

export async function intakeBuyerRequest(
  input: UnifiedIntakeInput,
): Promise<UnifiedIntakeResult> {
  // 1. Each BuyerOpportunity is keyed on a unique sessionId. Structured
  //    submissions have no chat session, so synthesize one.
  const sessionId = crypto.randomUUID();
  const source =
    input.source + (input.campaign ? `:${input.campaign}` : "");

  // 2. Create the BuyerOpportunity FIRST — it is the AI-enrichment anchor and
  //    the pipeline writes back to it. completed:true because this is a
  //    structured one-shot submission, not an in-progress conversation.
  const opportunity = await prisma.buyerOpportunity.create({
    data: {
      sessionId,
      source,
      buyerId: input.buyerId ?? null,
      phone: input.phone ?? null,
      firstName: input.firstName ?? null,
      email: input.email ?? null,
      vehicleType: input.vehicleType ?? null,
      make: input.make ?? null,
      model: input.model ?? null,
      yearMin: input.yearMin ?? null,
      yearMax: input.yearMax ?? null,
      trim: input.trim ?? null,
      // BuyerOpportunity.budgetAmount stored as dollars
      // (legacy concierge convention); VehicleRequest stores
      // cents. Input contract = cents, convert here.
      budgetAmount: input.budgetAmount != null
        ? Math.round(input.budgetAmount / 100)
        : null,
      monthlyPayment: input.monthlyPayment ?? null,
      timeline: input.timeline ?? null,
      zip: input.zip ?? null,
      hasTradeIn: input.hasTradeIn ?? null,
      tradeInDetails: (input.tradeInDetails ?? undefined) as
        | Prisma.InputJsonValue
        | undefined,
      financingNeeded: input.financingNeeded ?? null,
      completed: true,
      messages: [],
    },
  });
  const opportunityId = opportunity.id;
  logger.info("[unified-intake] BuyerOpportunity created", {
    opportunityId,
    source,
  });

  // 3. Create the VehicleRequest if a buyer can be resolved, then link both
  //    records together via buyerOpportunityId.
  let vehicleRequestId: string | null = null;
  const buyerId = await resolveBuyerId(input);

  if (buyerId) {
    try {
      const baseData = {
        buyerId,
        status: "SUBMITTED" as const,
        makePreference: input.make ?? null,
        modelPreference: input.model ?? null,
        yearMin: input.yearMin ?? null,
        yearMax: input.yearMax ?? null,
        maxBudgetCents: input.budgetAmount ?? null,
        notes: input.notes ?? null,
        utmSource: input.utmSource ?? null,
        utmMedium: input.utmMedium ?? null,
        utmCampaign: input.utmCampaign ?? null,
        sourceUrl: input.sourceUrl ?? null,
        buyerOpportunityId: opportunityId,
      };

      // landingSource/referrer require the add_landing_source_referrer
      // migration. Until it is applied, the create throws P2022; we retry
      // WITHOUT those columns so a lead is never lost. Once applied, the first
      // attempt succeeds and the SEO attribution persists.
      try {
        const vehicleRequest = await prisma.vehicleRequest.create({
          data: {
            ...baseData,
            landingSource: input.landingSource ?? null,
            referrer: input.referrer ?? null,
          },
        });
        vehicleRequestId = vehicleRequest.id;
      } catch (err) {
        if (isMissingColumnError(err)) {
          logger.warn(
            "[unified-intake] landingSource/referrer migration pending — retrying without",
          );
          const vehicleRequest = await prisma.vehicleRequest.create({
            data: baseData,
          });
          vehicleRequestId = vehicleRequest.id;
        } else {
          throw err;
        }
      }

      // Backfill the opportunity's buyerId now that it is resolved, so the
      // two records stay consistent (the input may not have supplied one).
      if (!input.buyerId) {
        await prisma.buyerOpportunity.update({
          where: { id: opportunityId },
          data: { buyerId },
        });
      }

      logger.info("[unified-intake] VehicleRequest created + linked", {
        opportunityId,
        vehicleRequestId,
      });
    } catch (err) {
      logger.error("[unified-intake] VehicleRequest create failed:", err);
    }
  } else {
    logger.info(
      "[unified-intake] No buyer resolved — skipping VehicleRequest",
      { opportunityId },
    );
  }

  // 4. Enqueue the durable intake pipeline. The heavy background sequence
  //    (market enrichment, dealer discovery, phone-script drafting, lead
  //    scoring/alerts, dealer outreach) runs in the Inngest worker
  //    `intakeProcessFn`, keyed on buyerOpportunityId — inheriting retry/backoff,
  //    concurrency, and dead-letter, and re-drivable by the intake-reconcile
  //    cron. Best-effort emit: if the enqueue fails, the intake-reconcile cron
  //    re-drives the un-processed opportunity (intakeProcessedAt IS NULL) —
  //    whether or not it has a linked VehicleRequest.
  try {
    await inngest.send({
      name: "autolenis/intake.process",
      data: { buyerOpportunityId: opportunityId },
    });
    logger.info("[unified-intake] intake.process enqueued", { opportunityId });
  } catch (err) {
    logger.error(
      "[unified-intake] intake.process emit failed (reconciler will recover):",
      err,
    );
  }

  // 5. Return both IDs.
  return { buyerOpportunityId: opportunityId, vehicleRequestId };
}

// NOTE: lead scoring + hot-lead alerts (scoreAndAlert) and the market-enrichment
// / dealer-discovery / outreach sequence moved to intake-pipeline.service.ts,
// where they run inside the durable Inngest worker (S1). This service now only
// creates the records and enqueues autolenis/intake.process.
