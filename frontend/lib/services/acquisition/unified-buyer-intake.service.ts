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

import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  enrichMarketData,
  discoverDealers,
} from "./compound-search.service";
import { scoreLeadFromConversation } from "./scoring.service";
import { draftAndSaveScript } from "../dealer-recruitment/phone-script-drafter.service";
import {
  notifyFounderHotLead,
  sendHotLeadBuyerSms,
  type HotLeadData,
} from "./twilio.service";
import {
  sendBuyerOpportunityConfirmationEmail,
  sendFounderHotLeadAlertEmail,
} from "@/lib/services/email/resend.service";

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
}

export interface UnifiedIntakeResult {
  buyerOpportunityId: string;
  vehicleRequestId: string | null;
}

// The scoring service expects the conversation ExtractedData timeline enum.
// Structured submissions carry free-form timeline strings, so map the common
// values and fall back to null (scoring treats unknown timelines as no signal).
function coerceTimeline(
  timeline: string | undefined,
): "this_week" | "1_to_3_months" | "researching" | null {
  if (!timeline) return null;
  const t = timeline.toLowerCase();
  if (t === "this_week" || t === "1_to_3_months" || t === "researching") {
    return t;
  }
  if (t.includes("asap") || t.includes("week")) return "this_week";
  if (t.includes("30") || t.includes("60") || t.includes("month")) {
    return "1_to_3_months";
  }
  if (t.includes("research") || t.includes("just")) return "researching";
  return null;
}

function coerceVehicleType(
  vehicleType: string | undefined,
): "new" | "used" | "open" | null {
  if (!vehicleType) return null;
  const v = vehicleType.toLowerCase();
  if (v === "new") return "new";
  if (v === "used") return "used";
  if (v === "open" || v === "either") return "open";
  return null;
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
    console.error("[unified-intake] buyer find/create failed:", err);
    return null;
  }
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
  console.log("[unified-intake] BuyerOpportunity created", {
    opportunityId,
    source,
  });

  // 3. Create the VehicleRequest if a buyer can be resolved, then link both
  //    records together via buyerOpportunityId.
  let vehicleRequestId: string | null = null;
  const buyerId = await resolveBuyerId(input);

  if (buyerId) {
    try {
      const vehicleRequest = await prisma.vehicleRequest.create({
        data: {
          buyerId,
          status: "SUBMITTED",
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
        },
      });
      vehicleRequestId = vehicleRequest.id;

      // Backfill the opportunity's buyerId now that it is resolved, so the
      // two records stay consistent (the input may not have supplied one).
      if (!input.buyerId) {
        await prisma.buyerOpportunity.update({
          where: { id: opportunityId },
          data: { buyerId },
        });
      }

      console.log("[unified-intake] VehicleRequest created + linked", {
        opportunityId,
        vehicleRequestId,
      });
    } catch (err) {
      console.error("[unified-intake] VehicleRequest create failed:", err);
    }
  } else {
    console.log(
      "[unified-intake] No buyer resolved — skipping VehicleRequest",
      { opportunityId },
    );
  }

  // 4. Fire the Group 3 + 4A pipeline in the background. after() keeps the
  //    serverless function alive until this completes without blocking the
  //    caller's response. Stages 1-2 (extraction + record creation) are
  //    already done above, so we resume at 3b.
  after(async () => {
    // Stage 3b — compound searches in parallel (best effort).
    console.log("[unified-intake] STAGE 3b — firing compound searches");

    const enrichmentPromise = (async () => {
      if (!input.make || !input.model || !input.zip) {
        console.log(
          "[unified-intake] Skipping market enrichment — missing fields",
        );
        return;
      }
      try {
        const enrichment = await enrichMarketData({
          vehicleType: input.vehicleType ?? null,
          make: input.make,
          model: input.model,
          trim: input.trim ?? null,
          yearMin: input.yearMin ?? null,
          yearMax: input.yearMax ?? null,
          zip: input.zip,
        });

        if (enrichment) {
          await prisma.buyerOpportunity.update({
            where: { id: opportunityId },
            data: {
              marketMsrpEstimate: enrichment.msrpEstimate,
              marketAvgPaidPrice: enrichment.avgPaidPrice,
              marketTypicalMarkup: enrichment.typicalMarkup,
              marketGoodDealTarget: enrichment.goodDealTarget,
              marketNotes: enrichment.notes,
              marketEnrichedAt: new Date(),
            },
          });
          console.log("[unified-intake] Market enrichment saved");
        }
      } catch (err) {
        console.error("[unified-intake] Market enrichment FAILED:", err);
      }
    })();

    const dealerPromise = (async () => {
      if (!input.make || !input.zip) {
        console.log(
          "[unified-intake] Skipping dealer discovery — missing fields",
        );
        return;
      }
      try {
        const dealers = await discoverDealers({
          make: input.make,
          zip: input.zip,
          radiusMiles: 25,
        });

        if (dealers.length > 0) {
          await prisma.dealerProspect.createMany({
            data: dealers.map((d) => ({
              buyerOppId: opportunityId,
              name: d.name,
              address: d.address,
              city: d.city,
              state: d.state,
              zip: d.zip,
              phone: d.phone,
              email: d.email,
              website: d.website,
              brand: d.brand,
              sourceUrl: d.sourceUrl,
              searchScore: d.searchScore,
              status: "DISCOVERED",
            })),
            skipDuplicates: true,
          });
          console.log(
            `[unified-intake] Dealer discovery saved ${dealers.length} prospects`,
          );

          // Background phone-script drafting for each new prospect.
          const insertedProspects = await prisma.dealerProspect.findMany({
            where: {
              buyerOppId: opportunityId,
              status: "DISCOVERED",
              scriptDraftedAt: null,
            },
            select: { id: true },
          });

          console.log(
            `[unified-intake] Drafting phone scripts for ${insertedProspects.length} prospects`,
          );

          for (const p of insertedProspects) {
            try {
              const ok = await draftAndSaveScript(p.id);
              console.log(
                `[unified-intake] Phone script for ${p.id}: ${ok ? "OK" : "FAILED"}`,
              );
              // 12s between gpt-oss-120b calls — respects the free-tier TPM
              // budget, matching the concierge pipeline pacing.
              await new Promise((resolve) => setTimeout(resolve, 12000));
            } catch (err) {
              console.error(
                `[unified-intake] Script drafting threw for ${p.id}:`,
                err,
              );
            }
          }
        }
      } catch (err) {
        console.error("[unified-intake] Dealer discovery FAILED:", err);
      }
    })();

    await Promise.allSettled([enrichmentPromise, dealerPromise]);

    // Stage 4 — lead scoring + hot-lead notifications. Only meaningful once we
    // have a phone number to act on, mirroring the concierge gate.
    if (input.phone) {
      try {
        await scoreAndAlert(opportunityId, input);
        console.log("[unified-intake] STAGE 4 (scoring + notifications) OK");
      } catch (err) {
        console.error(
          "[unified-intake] STAGE 4 (scoring + notifications) FAILED:",
          err,
        );
      }
    }
  });

  // 5. Return both IDs.
  return { buyerOpportunityId: opportunityId, vehicleRequestId };
}

/**
 * Score the lead and, when hot, fire the four notification channels — the same
 * pattern used by /api/concierge's scoreAndAlert.
 */
async function scoreAndAlert(
  opportunityId: string,
  input: UnifiedIntakeInput,
): Promise<void> {
  try {
    const extractedData = {
      vehicleType: coerceVehicleType(input.vehicleType),
      make: input.make ?? null,
      model: input.model ?? null,
      budgetTotal: input.budgetAmount ?? null,
      monthlyPayment: input.monthlyPayment ?? null,
      tradeIn: input.hasTradeIn ?? null,
      timeline: coerceTimeline(input.timeline),
      zip: input.zip ?? null,
      phone: input.phone ?? null,
    };

    const scoreResult = await scoreLeadFromConversation(extractedData);

    await prisma.buyerOpportunity.update({
      where: { id: opportunityId },
      data: {
        leadScore: scoreResult.score,
        leadTemperature: scoreResult.temperature,
        scoringReason: scoreResult.reasoning,
      },
    });

    await prisma.leadScore.create({
      data: {
        sessionId: opportunityId,
        score: scoreResult.score,
        temperature: scoreResult.temperature,
        signals: scoreResult.signals as unknown as Prisma.JsonObject,
        reasoning: scoreResult.reasoning,
      },
    });

    if (scoreResult.temperature === "hot" && input.phone) {
      const vehicle =
        [input.make, input.model].filter(Boolean).join(" ") || "vehicle";

      // budgetAmount and monthlyPayment are in CENTS per the
      // unified intake contract; convert to dollars for the
      // user-facing hot-lead notifications.
      const budgetDisplay = input.budgetAmount != null
        ? `$${Math.round(input.budgetAmount / 100).toLocaleString()}`
        : input.monthlyPayment != null
          ? `$${Math.round(input.monthlyPayment / 100).toLocaleString()}/mo`
          : "not specified";

      const lead: HotLeadData = {
        firstName: input.firstName ?? undefined,
        vehicle,
        budget: budgetDisplay,
        timeline: input.timeline ?? "unknown",
        zip: input.zip ?? "unknown",
        score: scoreResult.score,
        sessionId: opportunityId,
        phone: input.phone,
      };

      console.log("[unified-intake] Hot lead detected — firing notifications", {
        opportunityId,
        phone: input.phone,
        email: input.email,
        vehicle,
        score: scoreResult.score,
      });

      const founderEmail = process.env.FOUNDER_EMAIL;
      const email = input.email ?? null;

      const results = await Promise.allSettled([
        // SMS channel
        notifyFounderHotLead(lead),
        sendHotLeadBuyerSms(lead),
        // Email channel — buyer
        email
          ? sendBuyerOpportunityConfirmationEmail({
              to: email,
              firstName: input.firstName ?? "there",
              vehicle,
              budget: budgetDisplay,
              timeline: input.timeline ?? "unknown",
              zip: input.zip ?? "unknown",
              sessionId: opportunityId,
            })
          : Promise.resolve({ sent: false, skipped: "no email" }),
        // Email channel — founder
        founderEmail
          ? sendFounderHotLeadAlertEmail({
              to: founderEmail,
              firstName: input.firstName ?? "Anonymous",
              email: email ?? "no email captured",
              phone: input.phone,
              vehicle,
              budget: budgetDisplay,
              timeline: input.timeline ?? "unknown",
              zip: input.zip ?? "unknown",
              score: scoreResult.score,
              scoringReason: scoreResult.reasoning,
              sessionId: opportunityId,
            })
          : Promise.resolve({ sent: false, skipped: "no founder email" }),
      ]);

      const [
        founderSmsResult,
        buyerSmsResult,
        buyerEmailResult,
        founderEmailResult,
      ] = results;

      const channels = [
        { name: "notifyFounderHotLead (SMS)", result: founderSmsResult },
        { name: "sendHotLeadBuyerSms (SMS)", result: buyerSmsResult },
        {
          name: "sendBuyerOpportunityConfirmationEmail",
          result: buyerEmailResult,
        },
        { name: "sendFounderHotLeadAlertEmail", result: founderEmailResult },
      ];

      channels.forEach(({ name, result }) => {
        if (result.status === "rejected") {
          console.error(`[unified-intake] ${name} FAILED:`, result.reason);
        } else {
          console.log(`[unified-intake] ${name} succeeded`);
        }
      });

      await prisma.buyerOpportunity.update({
        where: { id: opportunityId },
        data: {
          founderNotified: founderSmsResult.status === "fulfilled",
          buyerSmsSent: buyerSmsResult.status === "fulfilled",
          buyerEmailSent: buyerEmailResult.status === "fulfilled",
          founderEmailSent: founderEmailResult.status === "fulfilled",
        },
      });
    }
  } catch (err) {
    console.error("[unified-intake] scoreAndAlert error:", err);
  }
}
