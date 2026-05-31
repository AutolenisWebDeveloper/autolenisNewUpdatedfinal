// app/api/concierge/route.ts
// Streaming AI concierge backend. Streams a gpt-oss-120b conversation reply
// while persisting the transcript and running a separate non-streamed
// gpt-oss-20b strict-JSON extraction call after the stream completes.
// Phone capture triggers lead scoring + founder/buyer SMS in the same
// post-stream block — never blocks the buyer-visible response.

import type { NextRequest } from "next/server";
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

  const existingMessages = (opportunity.messages as unknown as ConciergeMessage[]) ?? [];
  const newMessages: ConciergeMessage[] = [
    ...existingMessages,
    { role: "user", content: userMessage },
  ];

  // Snapshot the row so post-stream code can reference its current state.
  const opportunitySnapshot = opportunity;

  // Build dynamic system prompt that includes current
  // profile state so the AI knows what's already captured
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

  const dynamicSystemPrompt = `${CONCIERGE_SYSTEM_PROMPT}

==============================================
CURRENT BUYER PROFILE — DATA ALREADY CAPTURED
==============================================
${captured.length > 0 ? captured.join("\n") : "Nothing captured yet."}

==============================================
STILL NEEDED
==============================================
${missing.length > 0 ? missing.join(", ") : "All required fields captured. Confirm next steps with the buyer."}

CRITICAL: Do NOT re-ask the buyer for any field already
listed above as captured. If you need to confirm or clarify
something captured, reference what you already have (e.g.
"I have your ZIP as 75024 — is that correct?"). Move the
conversation forward by asking ONLY for fields in the
STILL NEEDED list.

If STILL NEEDED is empty, tell the buyer you have everything
you need and that you're starting to find dealers in their
area who can compete for their business. Then end the turn.`;

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

        // After stream completes: persist transcript, run extraction,
        // and (if phone newly captured) score the lead and fire SMS.
        const finalMessages: ConciergeMessage[] = [
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

        const updated = await extractStructuredData(finalMessages, existingProfile);

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

        // Check if all required fields are captured — mark complete
        const allCaptured = !!(
          (updated.make || updated.bodyStyle) &&
          (updated.budgetAmount || updated.monthlyPayment) &&
          updated.timeline &&
          updated.zip &&
          updated.phone
        );

        if (allCaptured && !opportunitySnapshot.completed) {
          await prisma.buyerOpportunity.update({
            where: { id: opportunity.id },
            data: { completed: true },
          });
        }

        const phoneJustCaptured = !opportunitySnapshot.phone && updated.phone;
        if (phoneJustCaptured) {
          await scoreAndAlert(opportunitySnapshot.id, updated);
        }
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

      await Promise.allSettled([
        notifyFounderHotLead(lead),
        sendHotLeadBuyerSms(lead),
      ]);

      await prisma.buyerOpportunity.update({
        where: { id: opportunityId },
        data: {
          founderNotified: true,
          buyerSmsSent: true,
        },
      });
    }
  } catch (err) {
    console.error("[concierge] scoreAndAlert error:", err);
  }
}
