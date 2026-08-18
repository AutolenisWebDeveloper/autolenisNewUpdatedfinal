// lib/services/acquisition/intake-pipeline.service.ts
//
// S1 — the durable intake background pipeline.
//
// This is the sequence that used to run in two racing `after()` blocks (one in
// unified-buyer-intake, one in the API routes). It now runs inside the Inngest
// worker `intakeProcessFn`, driven off `buyerOpportunityId` ALONE so the S2
// reconciler — which only has the id — can re-drive a stranded intake. Every
// stage reconstructs what it needs from the persisted BuyerOpportunity row and
// is idempotent, so a re-drive never re-enriches, re-scores, re-alerts, or
// double-contacts a dealer.

import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enrichMarketData, discoverDealers } from "./compound-search.service";
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
import { sendDealersContactedEmail } from "@/lib/services/email/buyer-notifications.service";
import { runPostIntakeOutreach } from "./post-intake-outreach.service";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

export interface IntakePipelineResult {
  dealersContacted: number;
}

// The subset of intake facts the pipeline consumes, reconstructed from a
// persisted BuyerOpportunity. Budget is normalized back to CENTS (the row
// stores dollars) so the downstream scoring/notification math is unchanged.
interface IntakeFields {
  vehicleType: string | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  yearMin: number | null;
  yearMax: number | null;
  budgetAmount: number | null; // cents
  monthlyPayment: number | null; // cents
  hasTradeIn: boolean | null;
  timeline: string | null;
  zip: string | null;
  phone: string | null;
  firstName: string | null;
  email: string | null;
}

type OpportunityRow = {
  id: string;
  vehicleType: string | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  yearMin: number | null;
  yearMax: number | null;
  budgetAmount: number | null; // dollars, per legacy convention
  monthlyPayment: number | null; // cents
  hasTradeIn: boolean | null;
  timeline: string | null;
  zip: string | null;
  phone: string | null;
  firstName: string | null;
  email: string | null;
  marketEnrichedAt: Date | null;
  leadTemperature: string | null;
};

function buildIntakeFields(opp: OpportunityRow): IntakeFields {
  return {
    vehicleType: opp.vehicleType,
    make: opp.make,
    model: opp.model,
    trim: opp.trim,
    yearMin: opp.yearMin,
    yearMax: opp.yearMax,
    // Row stores dollars; the pipeline contract is cents.
    budgetAmount: opp.budgetAmount != null ? opp.budgetAmount * 100 : null,
    monthlyPayment: opp.monthlyPayment,
    hasTradeIn: opp.hasTradeIn,
    timeline: opp.timeline,
    zip: opp.zip,
    phone: opp.phone,
    firstName: opp.firstName,
    email: opp.email,
  };
}

function coerceTimeline(
  timeline: string | null,
): "this_week" | "1_to_3_months" | "researching" | null {
  if (!timeline) return null;
  const t = timeline.toLowerCase();
  if (t === "this_week" || t === "1_to_3_months" || t === "researching") return t;
  if (t.includes("asap") || t.includes("week")) return "this_week";
  if (t.includes("30") || t.includes("60") || t.includes("month")) return "1_to_3_months";
  if (t.includes("research") || t.includes("just")) return "researching";
  return null;
}

function coerceVehicleType(vehicleType: string | null): "new" | "used" | "open" | null {
  if (!vehicleType) return null;
  const v = vehicleType.toLowerCase();
  if (v === "new") return "new";
  if (v === "used") return "used";
  if (v === "open" || v === "either") return "open";
  return null;
}

/**
 * Score the lead and, when hot, fire the four notification channels. Moved here
 * from unified-buyer-intake with its behavior preserved; the caller guards it so
 * a re-drive of an already-scored opportunity never re-notifies.
 */
async function scoreAndAlert(opportunityId: string, fields: IntakeFields): Promise<void> {
  try {
    const extractedData = {
      vehicleType: coerceVehicleType(fields.vehicleType),
      make: fields.make,
      model: fields.model,
      budgetTotal: fields.budgetAmount != null ? Math.round(fields.budgetAmount / 100) : null,
      monthlyPayment: fields.monthlyPayment != null ? Math.round(fields.monthlyPayment / 100) : null,
      tradeIn: fields.hasTradeIn,
      timeline: coerceTimeline(fields.timeline),
      zip: fields.zip,
      phone: fields.phone,
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

    if (scoreResult.temperature === "hot" && fields.phone) {
      const vehicle = [fields.make, fields.model].filter(Boolean).join(" ") || "vehicle";
      const budgetDisplay = fields.budgetAmount != null
        ? `$${Math.round(fields.budgetAmount / 100).toLocaleString()}`
        : fields.monthlyPayment != null
          ? `$${Math.round(fields.monthlyPayment / 100).toLocaleString()}/mo`
          : "not specified";

      const lead: HotLeadData = {
        firstName: fields.firstName ?? undefined,
        vehicle,
        budget: budgetDisplay,
        timeline: fields.timeline ?? "unknown",
        zip: fields.zip ?? "unknown",
        score: scoreResult.score,
        sessionId: opportunityId,
        phone: fields.phone,
      };

      const founderEmail = process.env.FOUNDER_EMAIL;
      const email = fields.email ?? null;

      const results = await Promise.allSettled([
        notifyFounderHotLead(lead),
        sendHotLeadBuyerSms(lead),
        email
          ? sendBuyerOpportunityConfirmationEmail({
              to: email,
              firstName: fields.firstName ?? "there",
              vehicle,
              budget: budgetDisplay,
              timeline: fields.timeline ?? "unknown",
              zip: fields.zip ?? "unknown",
              sessionId: opportunityId,
            })
          : Promise.resolve({ sent: false, skipped: "no email" }),
        founderEmail
          ? sendFounderHotLeadAlertEmail({
              to: founderEmail,
              firstName: fields.firstName ?? "Anonymous",
              email: email ?? "no email captured",
              phone: fields.phone,
              vehicle,
              budget: budgetDisplay,
              timeline: fields.timeline ?? "unknown",
              zip: fields.zip ?? "unknown",
              score: scoreResult.score,
              scoringReason: scoreResult.reasoning,
              sessionId: opportunityId,
            })
          : Promise.resolve({ sent: false, skipped: "no founder email" }),
      ]);

      const [founderSms, buyerSms, buyerEmail, founderEmailRes] = results;
      await prisma.buyerOpportunity.update({
        where: { id: opportunityId },
        data: {
          founderNotified: founderSms.status === "fulfilled",
          buyerSmsSent: buyerSms.status === "fulfilled",
          buyerEmailSent: buyerEmail.status === "fulfilled",
          founderEmailSent: founderEmailRes.status === "fulfilled",
        },
      });
    }
  } catch (err) {
    logger.error("[intake-pipeline] scoreAndAlert error:", err);
  }
}

/**
 * Run the full intake background pipeline for one BuyerOpportunity. Idempotent:
 * safe to re-run (the S2 reconciler relies on this). Throws only when the
 * opportunity is missing, so the worker retries/dead-letters.
 */
export async function runIntakePipeline(buyerOpportunityId: string): Promise<IntakePipelineResult> {
  const opp = (await prisma.buyerOpportunity.findUnique({
    where: { id: buyerOpportunityId },
    select: {
      id: true, vehicleType: true, make: true, model: true, trim: true,
      yearMin: true, yearMax: true, budgetAmount: true, monthlyPayment: true,
      hasTradeIn: true, timeline: true, zip: true, phone: true,
      firstName: true, email: true, marketEnrichedAt: true, leadTemperature: true,
    },
  })) as OpportunityRow | null;

  if (!opp) throw new Error(`BuyerOpportunity ${buyerOpportunityId} not found`);
  const fields = buildIntakeFields(opp);

  // Stage 3b — market enrichment + dealer discovery (independent; run together).
  const enrichmentPromise = (async () => {
    if (opp.marketEnrichedAt) return; // already enriched — idempotent re-drive
    if (!fields.make || !fields.model || !fields.zip) return;
    try {
      const enrichment = await enrichMarketData({
        vehicleType: fields.vehicleType,
        make: fields.make,
        model: fields.model,
        trim: fields.trim,
        yearMin: fields.yearMin,
        yearMax: fields.yearMax,
        zip: fields.zip,
      });
      if (enrichment) {
        await prisma.buyerOpportunity.update({
          where: { id: buyerOpportunityId },
          data: {
            marketMsrpEstimate: enrichment.msrpEstimate,
            marketAvgPaidPrice: enrichment.avgPaidPrice,
            marketTypicalMarkup: enrichment.typicalMarkup,
            marketGoodDealTarget: enrichment.goodDealTarget,
            marketNotes: enrichment.notes,
            marketEnrichedAt: new Date(),
          },
        });
      }
    } catch (err) {
      logger.error("[intake-pipeline] market enrichment failed:", err);
    }
  })();

  const dealerPromise = (async () => {
    if (!fields.make || !fields.zip) return;
    // Idempotent re-drive guard: DealerProspect has no unique constraint on the
    // intake identity, so createMany({ skipDuplicates }) would NOT dedupe — a
    // re-run (reconciler / late duplicate delivery) would insert a second full
    // set of prospects and the outreach stage would re-email the same dealers.
    // Skip discovery entirely once this opportunity already has prospects.
    const existingProspects = await prisma.dealerProspect.count({
      where: { buyerOppId: buyerOpportunityId },
    });
    if (existingProspects > 0) return;
    try {
      const dealers = await discoverDealers({ make: fields.make, zip: fields.zip, radiusMiles: 25 });
      if (dealers.length > 0) {
        await prisma.dealerProspect.createMany({
          data: dealers.map((d) => ({
            buyerOppId: buyerOpportunityId,
            name: d.name, address: d.address, city: d.city, state: d.state, zip: d.zip,
            phone: d.phone, email: d.email, website: d.website, brand: d.brand,
            sourceUrl: d.sourceUrl, searchScore: d.searchScore, status: "DISCOVERED",
          })),
          skipDuplicates: true,
        });
        // Phone-script drafting only for prospects without one (idempotent).
        const pending = await prisma.dealerProspect.findMany({
          where: { buyerOppId: buyerOpportunityId, status: "DISCOVERED", scriptDraftedAt: null },
          select: { id: true },
        });
        for (const p of pending) {
          try {
            await draftAndSaveScript(p.id);
            await new Promise((resolve) => setTimeout(resolve, 12000));
          } catch (err) {
            logger.error(`[intake-pipeline] script drafting threw for ${p.id}:`, err);
          }
        }
      }
    } catch (err) {
      logger.error("[intake-pipeline] dealer discovery failed:", err);
    }
  })();

  await Promise.allSettled([enrichmentPromise, dealerPromise]);

  // Stage 4 — lead scoring + hot-lead alerts. Guarded so a re-drive of an
  // already-scored opportunity never re-scores or re-notifies.
  if (fields.phone && !opp.leadTemperature) {
    await scoreAndAlert(buyerOpportunityId, fields);
  }

  // Stage 5 — dealer outreach (self-idempotent: skips prospects already
  // contacted), then the buyer "dealers contacted" confirmation.
  const { dealersContacted } = await runPostIntakeOutreach(buyerOpportunityId);
  if (dealersContacted > 0 && fields.email) {
    await sendDealersContactedEmail({
      buyerEmail: fields.email,
      buyerFirstName: fields.firstName ?? "there",
      vehicleMake: fields.make ?? fields.vehicleType ?? "",
      vehicleModel: fields.model ?? "",
      dealerCount: dealersContacted,
      depositUrl: `${APP_URL}/buyer/deposit`,
    }).catch((err) => logger.error("[intake-pipeline] dealers-contacted email failed:", err));
  }

  return { dealersContacted };
}
