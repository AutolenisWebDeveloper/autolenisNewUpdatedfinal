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
      },
    });
  }

  const existingMessages = (opportunity.messages as unknown as ConciergeMessage[]) ?? [];
  const newMessages: ConciergeMessage[] = [
    ...existingMessages,
    { role: "user", content: userMessage },
  ];

  // Snapshot the row so post-stream code can reference its current state.
  const opportunitySnapshot = opportunity;

  const encoder = new TextEncoder();
  let assistantReply = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamConcierge(
          CONCIERGE_SYSTEM_PROMPT,
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
