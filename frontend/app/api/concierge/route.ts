// app/api/concierge/route.ts
// Streaming AI concierge backend. Streams a gpt-oss-120b conversation reply
// while persisting the transcript and running a separate non-streamed
// gpt-oss-20b strict-JSON extraction call after the stream completes.
// Phone capture triggers lead scoring + founder/buyer SMS in the same
// post-stream block — never blocks the buyer-visible response.
//
// Required env vars:
//   GROQ_API_KEY            - Groq API key
//   ANTHROPIC_API_KEY       - Claude Haiku for buyer SMS
//   TWILIO_*                - SMS provider config
//   FOUNDER_PHONE_NUMBER    - SMS hot-lead recipient
//   FOUNDER_EMAIL           - Email hot-lead recipient (NEW)
//   RESEND_API_KEY          - Email provider
//   NEXT_PUBLIC_APP_URL     - Used in email CTAs

import type { NextRequest } from "next/server";
import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  streamConcierge,
  extractStructuredData,
  type ConciergeMessage,
  type BuyerProfile,
} from "@/lib/ai/acquisition";
import { CONCIERGE_SYSTEM_PROMPT } from "@/lib/ai/concierge-prompt";
import { scoreLeadFromConversation } from "@/lib/services/acquisition/scoring.service";
import {
  notifyFounderHotLead,
  sendHotLeadBuyerSms,
  type HotLeadData,
} from "@/lib/services/acquisition/twilio.service";
import {
  sendBuyerOpportunityConfirmationEmail,
  sendFounderHotLeadAlertEmail,
} from "@/lib/services/email/resend.service";
import {
  enrichMarketData,
  discoverDealers,
} from "@/lib/services/acquisition/compound-search.service";
import { draftAndSaveScript } from "@/lib/services/dealer-recruitment/phone-script-drafter.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ConciergeRequest {
  sessionId: string;
  userMessage: string;
  firstName?: string; // Sent only on first turn after lead gate
  email?: string; // Sent only on first turn after lead gate
}

export async function POST(request: NextRequest) {
  let body: ConciergeRequest;
  try {
    body = (await request.json()) as ConciergeRequest;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { sessionId, userMessage } = body;

  if (!sessionId || typeof sessionId !== "string") {
    return new Response("sessionId required", { status: 400 });
  }

  if (!userMessage || typeof userMessage !== "string") {
    return new Response("userMessage required", { status: 400 });
  }

  // Load or create BuyerOpportunity row keyed on sessionId.
  let opportunity = await prisma.buyerOpportunity.findUnique({
    where: { sessionId },
  });

  if (!opportunity) {
    opportunity = await prisma.buyerOpportunity.create({
      data: {
        sessionId,
        messages: [],
        firstName: body.firstName ?? null,
        email: body.email ?? null,
      },
    });
  } else if (body.firstName || body.email) {
    // Backfill name/email on an existing row only when they're currently null.
    const patch: { firstName?: string; email?: string } = {};
    if (body.firstName && !opportunity.firstName) patch.firstName = body.firstName;
    if (body.email && !opportunity.email) patch.email = body.email;
    if (Object.keys(patch).length > 0) {
      opportunity = await prisma.buyerOpportunity.update({
        where: { id: opportunity.id },
        data: patch,
      });
    }
  }

  // Load existing messages to include in prompt context
  const existingMessages = (opportunity.messages as unknown as ConciergeMessage[]) ?? [];
  const newMessages: ConciergeMessage[] = [
    ...existingMessages,
    { role: "user", content: userMessage },
  ];

  // Snapshot the row so post-stream code can reference its current state.
  const opportunitySnapshot = opportunity;

  // Build current profile state from BuyerOpportunity row
  const currentProfile = {
    vehicleType: opportunity.vehicleType,
    make: opportunity.make,
    model: opportunity.model,
    bodyStyle: opportunity.bodyStyle,
    budgetAmount: opportunity.budgetAmount,
    monthlyPayment: opportunity.monthlyPayment,
    timeline: opportunity.timeline,
    zip: opportunity.zip,
    phone: opportunity.phone,
    hasTradeIn: opportunity.hasTradeIn,
    firstName: opportunity.firstName,
  };

  // Format already-captured fields for AI awareness
  const captured: string[] = [];
  if (currentProfile.firstName) captured.push(`Name: ${currentProfile.firstName}`);
  if (currentProfile.vehicleType) captured.push(`Condition: ${currentProfile.vehicleType}`);
  if (currentProfile.make && currentProfile.model) captured.push(`Vehicle: ${currentProfile.make} ${currentProfile.model}`);
  else if (currentProfile.make) captured.push(`Make: ${currentProfile.make}`);
  else if (currentProfile.bodyStyle) captured.push(`Body style: ${currentProfile.bodyStyle}`);
  if (currentProfile.budgetAmount) captured.push(`Budget: $${currentProfile.budgetAmount.toLocaleString()}`);
  if (currentProfile.monthlyPayment) captured.push(`Monthly payment: $${currentProfile.monthlyPayment}/mo`);
  if (currentProfile.timeline) captured.push(`Timeline: ${currentProfile.timeline}`);
  if (currentProfile.zip) captured.push(`ZIP: ${currentProfile.zip}`);
  if (currentProfile.phone) captured.push(`Phone: ${currentProfile.phone}`);
  if (currentProfile.hasTradeIn !== null && currentProfile.hasTradeIn !== undefined) {
    captured.push(`Trade-in: ${currentProfile.hasTradeIn ? "yes" : "no"}`);
  }

  // Determine what's still missing
  const missing: string[] = [];
  if (!currentProfile.make && !currentProfile.bodyStyle) missing.push("vehicle");
  if (!currentProfile.budgetAmount && !currentProfile.monthlyPayment) missing.push("budget");
  if (!currentProfile.timeline) missing.push("timeline");
  if (!currentProfile.zip) missing.push("zip");
  if (!currentProfile.phone) missing.push("phone");

  // Determine the turn number so the AI knows context
  const turnNumber = Math.floor(existingMessages.length / 2) + 1;

  const dynamicSystemPrompt = `${CONCIERGE_SYSTEM_PROMPT}

==============================================
CURRENT BUYER PROFILE — STRUCTURED DATA CAPTURED
==============================================
${captured.length > 0 ? captured.join("\n") : "Nothing captured yet."}

==============================================
STILL NEEDED
==============================================
${missing.length > 0 ? missing.join(", ") : "All required fields captured. Confirm next steps with the buyer."}

==============================================
CONVERSATION CONTEXT
==============================================
You have already had ${turnNumber - 1} previous exchange(s) with this buyer in this session.
The full conversation history is in the messages array below — review it carefully before responding.

CRITICAL RULES:
1. NEVER re-ask the buyer for any field listed above as captured.
2. NEVER re-ask the buyer for anything they have ALREADY TOLD YOU in the conversation history — even if it's not in the captured list yet (extraction may be delayed). Read the conversation transcript carefully.
3. If you confirmed information in a previous turn (e.g. "I've got 2024 Toyota Highlander XLE"), TREAT IT AS LOCKED IN. Do not ask about it again.
4. If STILL NEEDED is empty, tell the buyer you have everything you need and you're starting to find dealers in their area who can compete. Then end the turn.
5. The buyer's most recent message often refers to topics from earlier in the conversation. Read the FULL history before interpreting it.
6. If the buyer mentions financing, trade-in, or other details, store them mentally but only ask follow-up questions if those details are still genuinely needed.`;

  const encoder = new TextEncoder();
  let assistantReply = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamConcierge(
          dynamicSystemPrompt,
          newMessages,
        )) {
          assistantReply += chunk;
          controller.enqueue(encoder.encode(chunk));
        }

        controller.close();
      } catch (err) {
        console.error("[concierge] Stream error:", err);
        try {
          controller.enqueue(
            encoder.encode("\n\nI'm having trouble right now. Please try again."),
          );
          controller.close();
        } catch {
          // Stream already closed — nothing to do.
        }
      }
    },
  });

  // Register background work that must complete after the response is
  // sent. Vercel keeps the function alive until this work finishes
  // (up to the function timeout). Without after(), this work can be
  // terminated mid-flight on serverless once the response closes.
  after(async () => {
    // Stage 1: Build context and run extraction
    let updated: BuyerProfile | null = null;
    let finalMessages: ConciergeMessage[] = [];

    try {
      finalMessages = [
        ...newMessages,
        { role: "assistant", content: assistantReply },
      ];

      const existingProfile: Partial<BuyerProfile> = {
        vehicleType: opportunitySnapshot.vehicleType as BuyerProfile["vehicleType"],
        make: opportunitySnapshot.make,
        model: opportunitySnapshot.model,
        bodyStyle: opportunitySnapshot.bodyStyle,
        yearMin: opportunitySnapshot.yearMin,
        yearMax: opportunitySnapshot.yearMax,
        trim: opportunitySnapshot.trim,
        budgetType: opportunitySnapshot.budgetType as BuyerProfile["budgetType"],
        budgetAmount: opportunitySnapshot.budgetAmount,
        monthlyPayment: opportunitySnapshot.monthlyPayment,
        timeline: opportunitySnapshot.timeline as BuyerProfile["timeline"],
        zip: opportunitySnapshot.zip,
        phone: opportunitySnapshot.phone,
        hasTradeIn: opportunitySnapshot.hasTradeIn,
        financingNeeded: opportunitySnapshot.financingNeeded,
        firstName: opportunitySnapshot.firstName,
      };

      updated = await extractStructuredData(finalMessages, existingProfile);
      console.log("[concierge] Extraction completed", {
        opportunityId: opportunitySnapshot.id,
        captured: {
          make: updated.make,
          model: updated.model,
          zip: updated.zip,
          phone: updated.phone,
          timeline: updated.timeline,
        },
      });
    } catch (err) {
      console.error("[concierge] STAGE 1 (extraction) FAILED:", err);
      return; // Cannot continue without extraction
    }

    if (!updated) {
      console.error("[concierge] Extraction returned null — aborting after()");
      return;
    }

    // Stage 2: Persist extracted data
    try {
      await prisma.buyerOpportunity.update({
        where: { id: opportunitySnapshot.id },
        data: {
          messages: finalMessages as unknown as Prisma.JsonArray,
          vehicleType: updated.vehicleType,
          make: updated.make,
          model: updated.model,
          bodyStyle: updated.bodyStyle,
          yearMin: updated.yearMin,
          yearMax: updated.yearMax,
          trim: updated.trim,
          budgetType: updated.budgetType,
          budgetAmount: updated.budgetAmount,
          monthlyPayment: updated.monthlyPayment,
          timeline: updated.timeline,
          zip: updated.zip,
          phone: updated.phone,
          hasTradeIn: updated.hasTradeIn,
          financingNeeded: updated.financingNeeded,
          firstName: updated.firstName,
        },
      });
      console.log("[concierge] STAGE 2 (persist) OK");
    } catch (err) {
      console.error("[concierge] STAGE 2 (persist) FAILED:", err);
      // Continue to scoring even if persist failed — scoring uses
      // the in-memory profile not the DB
    }

    // Stage 3: Completion detection + compound searches
    const allCaptured = !!(
      (updated.make || updated.bodyStyle) &&
      (updated.budgetAmount || updated.monthlyPayment) &&
      updated.timeline &&
      updated.zip &&
      updated.phone
    );

    if (allCaptured && !opportunitySnapshot.completed) {
      try {
        await prisma.buyerOpportunity.update({
          where: { id: opportunitySnapshot.id },
          data: { completed: true },
        });
        console.log("[concierge] STAGE 3a (completion flag) OK");
      } catch (err) {
        console.error("[concierge] STAGE 3a (completion flag) FAILED:", err);
      }

      // Compound searches in parallel — best effort
      console.log("[concierge] STAGE 3b — firing compound searches");

      const enrichmentPromise = (async () => {
        if (!updated!.make || !updated!.model || !updated!.zip) {
          console.log("[concierge] Skipping market enrichment — missing fields");
          return null;
        }
        try {
          const enrichment = await enrichMarketData({
            vehicleType: updated!.vehicleType,
            make: updated!.make,
            model: updated!.model,
            trim: updated!.trim,
            yearMin: updated!.yearMin,
            yearMax: updated!.yearMax,
            zip: updated!.zip,
          });

          if (enrichment) {
            await prisma.buyerOpportunity.update({
              where: { id: opportunitySnapshot.id },
              data: {
                marketMsrpEstimate: enrichment.msrpEstimate,
                marketAvgPaidPrice: enrichment.avgPaidPrice,
                marketTypicalMarkup: enrichment.typicalMarkup,
                marketGoodDealTarget: enrichment.goodDealTarget,
                marketNotes: enrichment.notes,
                marketEnrichedAt: new Date(),
              },
            });
            console.log("[concierge] Market enrichment saved");
          }
        } catch (err) {
          console.error("[concierge] Market enrichment FAILED:", err);
        }
      })();

      const dealerPromise = (async () => {
        if (!updated!.make || !updated!.zip) {
          console.log("[concierge] Skipping dealer discovery — missing fields");
          return null;
        }
        try {
          const dealers = await discoverDealers({
            make: updated!.make,
            zip: updated!.zip,
            radiusMiles: 25,
          });

          if (dealers.length > 0) {
            await prisma.dealerProspect.createMany({
              data: dealers.map((d) => ({
                buyerOppId: opportunitySnapshot.id,
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
            console.log(`[concierge] Dealer discovery saved ${dealers.length} prospects`);

            // Background script drafting for each newly-discovered prospect
            const insertedProspects = await prisma.dealerProspect.findMany({
              where: {
                buyerOppId: opportunitySnapshot.id,
                status: "DISCOVERED",
                scriptDraftedAt: null,
              },
              select: { id: true },
            });

            console.log(
              `[concierge] Drafting phone scripts for ${insertedProspects.length} prospects`,
            );

            for (const p of insertedProspects) {
              try {
                const ok = await draftAndSaveScript(p.id);
                console.log(`[concierge] Phone script for ${p.id}: ${ok ? "OK" : "FAILED"}`);
                // 500ms gap between gpt-oss-120b calls to respect TPM
                await new Promise((resolve) => setTimeout(resolve, 500));
              } catch (err) {
                console.error(`[concierge] Script drafting threw for ${p.id}:`, err);
              }
            }
          }
        } catch (err) {
          console.error("[concierge] Dealer discovery FAILED:", err);
        }
      })();

      await Promise.allSettled([enrichmentPromise, dealerPromise]);
    }

    // Stage 4: Hot-lead notifications
    const phoneJustCaptured = !opportunitySnapshot.phone && updated.phone;
    if (phoneJustCaptured) {
      try {
        await scoreAndAlert(
          opportunitySnapshot.id,
          updated,
          opportunitySnapshot.email,
        );
        console.log("[concierge] STAGE 4 (scoring + notifications) OK");
      } catch (err) {
        console.error("[concierge] STAGE 4 (scoring + notifications) FAILED:", err);
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function scoreAndAlert(
  opportunityId: string,
  profile: BuyerProfile,
  email: string | null,
): Promise<void> {
  try {
    const extractedData = {
      vehicleType: profile.vehicleType,
      make: profile.make,
      model: profile.model,
      budgetTotal: profile.budgetAmount,
      monthlyPayment: profile.monthlyPayment,
      tradeIn: profile.hasTradeIn,
      timeline: profile.timeline,
      zip: profile.zip,
      phone: profile.phone,
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

    if (scoreResult.temperature === "hot" && profile.phone) {
      const vehicle =
        [profile.make, profile.model].filter(Boolean).join(" ") ||
        profile.bodyStyle ||
        "vehicle";

      const budget = profile.budgetAmount
        ? `$${profile.budgetAmount.toLocaleString()}`
        : profile.monthlyPayment
          ? `$${profile.monthlyPayment}/mo`
          : "not specified";

      const lead: HotLeadData = {
        firstName: profile.firstName ?? undefined,
        vehicle,
        budget,
        timeline: profile.timeline ?? "unknown",
        zip: profile.zip ?? "unknown",
        score: scoreResult.score,
        sessionId: opportunityId,
        phone: profile.phone,
      };

      console.log("[concierge] Hot lead detected — firing notifications", {
        opportunityId,
        phone: profile.phone,
        email,
        vehicle,
        score: scoreResult.score,
      });

      // Fire all four notification channels in parallel
      const founderEmail = process.env.FOUNDER_EMAIL;

      const results = await Promise.allSettled([
        // SMS channel
        notifyFounderHotLead(lead),
        sendHotLeadBuyerSms(lead),
        // Email channel — buyer
        email
          ? sendBuyerOpportunityConfirmationEmail({
              to: email,
              firstName: profile.firstName ?? "there",
              vehicle,
              budget,
              timeline: profile.timeline ?? "unknown",
              zip: profile.zip ?? "unknown",
              sessionId: opportunityId,
            })
          : Promise.resolve({ sent: false, skipped: "no email" }),
        // Email channel — founder
        founderEmail
          ? sendFounderHotLeadAlertEmail({
              to: founderEmail,
              firstName: profile.firstName ?? "Anonymous",
              email: email ?? "no email captured",
              phone: profile.phone,
              vehicle,
              budget,
              timeline: profile.timeline ?? "unknown",
              zip: profile.zip ?? "unknown",
              score: scoreResult.score,
              scoringReason: scoreResult.reasoning,
              sessionId: opportunityId,
            })
          : Promise.resolve({ sent: false, skipped: "no founder email" }),
      ]);

      const [founderSmsResult, buyerSmsResult, buyerEmailResult, founderEmailResult] = results;

      // Log per-channel outcomes
      const channels = [
        { name: "notifyFounderHotLead (SMS)", result: founderSmsResult },
        { name: "sendHotLeadBuyerSms (SMS)", result: buyerSmsResult },
        { name: "sendBuyerOpportunityConfirmationEmail", result: buyerEmailResult },
        { name: "sendFounderHotLeadAlertEmail", result: founderEmailResult },
      ];

      channels.forEach(({ name, result }) => {
        if (result.status === "rejected") {
          console.error(`[concierge] ${name} FAILED:`, result.reason);
        } else {
          console.log(`[concierge] ${name} succeeded`);
        }
      });

      // Update flags — separate flag per channel for accurate tracking
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
    console.error("[concierge] scoreAndAlert error:", err);
  }
}
