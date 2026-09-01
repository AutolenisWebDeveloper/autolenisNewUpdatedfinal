// app/api/finder/route.ts
// Conversational vehicle finder backend. Drives an 8-turn scripted flow:
// the buyer's free-text answers are merged into a structured ExtractedData
// blob; on turn 7 (phone capture) we score the lead and fire a hot-lead
// SMS to the founder if the score crosses the threshold. The route never
// returns 5xx on Groq failure — the next question is always served.

import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  extractVehicleData,
  type ExtractedData,
} from "@/lib/ai/acquisition";
import { scoreLeadFromConversation } from "@/lib/services/acquisition/scoring.service";
import {
  notifyFounderHotLead,
  sendHotLeadBuyerSms,
  type HotLeadData,
} from "@/lib/services/acquisition/twilio.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Scripted question sequence — turnNumber refers to the question the buyer
// is *answering* in their POST. nextQuestion is what we ask after they
// answer turn N (i.e. QUESTIONS[N] when turn=N is the just-answered turn).
const QUESTIONS: Record<number, string> = {
  1: "Are you looking to buy new, used, or are you open to both?",
  2: "What vehicle or type of vehicle are you interested in? Make, model, or just a body type like SUV or truck is fine.",
  3: "What is your target budget — total price, or do you think in monthly payments?",
  4: "Do you have a trade-in?",
  5: "When are you looking to buy — this week, within the next 1–3 months, or just researching for now?",
  6: "What ZIP code should dealers be near?",
  7: "Last step — what is your best mobile number? Dealers will send their best offers directly to you. By providing your number you agree to receive automated texts from AutoLenis. Reply STOP to opt out at any time.",
};

function buildConfirmation(extracted: ExtractedData): string {
  const zip = extracted.zip ?? "your area";
  const vehicle =
    [extracted.make, extracted.model].filter(Boolean).join(" ").trim() ||
    extracted.vehicleType ||
    "vehicle";
  return `You are all set! Dealers near ${zip} will compete for your ${vehicle} within 48 hours. Watch for a text from AutoLenis.`;
}

function emptyExtracted(): ExtractedData {
  return {
    vehicleType: null,
    make: null,
    model: null,
    budgetTotal: null,
    monthlyPayment: null,
    tradeIn: null,
    timeline: null,
    zip: null,
    phone: null,
  };
}

function asExtracted(value: unknown): ExtractedData {
  if (!value || typeof value !== "object") return emptyExtracted();
  return { ...emptyExtracted(), ...(value as Partial<ExtractedData>) };
}

interface TranscriptEntry {
  role: "user" | "ai";
  message: string;
  turn: number;
  ts: number;
}

function asTranscript(value: unknown): TranscriptEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is TranscriptEntry =>
      !!e &&
      typeof e === "object" &&
      typeof (e as TranscriptEntry).role === "string" &&
      typeof (e as TranscriptEntry).message === "string",
  );
}

function describeBudget(d: ExtractedData): string {
  if (typeof d.budgetTotal === "number") return `$${d.budgetTotal.toLocaleString()} total`;
  if (typeof d.monthlyPayment === "number") return `$${d.monthlyPayment}/mo`;
  return "Not specified";
}

function describeTimeline(t: ExtractedData["timeline"]): string {
  if (t === "this_week") return "This week";
  if (t === "1_to_3_months") return "1-3 months";
  if (t === "researching") return "Researching";
  return "Not specified";
}

function describeVehicle(d: ExtractedData): string {
  const v = [d.make, d.model].filter(Boolean).join(" ").trim();
  return v || d.vehicleType || "Unspecified";
}

export async function POST(req: Request) {
  let payload: { sessionId?: string; userMessage?: string; turnNumber?: number };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = payload.sessionId?.trim();
  const userMessage = payload.userMessage?.toString() ?? "";
  const turnNumber = Number(payload.turnNumber);

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  if (!Number.isFinite(turnNumber) || turnNumber < 1 || turnNumber > 8) {
    return NextResponse.json({ error: "turnNumber must be between 1 and 8" }, { status: 400 });
  }

  // Load or create the conversation row keyed on sessionId.
  let conversation = await prisma.conversation.findUnique({
    where: { sessionId },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        sessionId,
        transcript: [],
        extractedData: emptyExtracted() as unknown as object,
      },
    });
  }

  const existingExtracted = asExtracted(conversation.extractedData);
  const transcript = asTranscript(conversation.transcript);
  transcript.push({
    role: "user",
    message: userMessage,
    turn: turnNumber,
    ts: Date.now(),
  });

  // Extract structured fields from the user's message. Errors swallowed
  // inside extractVehicleData; we always get back a valid ExtractedData.
  const extractedData = await extractVehicleData(userMessage, existingExtracted);

  const nextQuestion =
    turnNumber >= 7
      ? buildConfirmation(extractedData)
      : (QUESTIONS[turnNumber + 1] ?? buildConfirmation(extractedData));

  const complete = turnNumber >= 7;

  transcript.push({
    role: "ai",
    message: nextQuestion,
    turn: turnNumber + 1,
    ts: Date.now(),
  });

  await prisma.conversation.update({
    where: { sessionId },
    data: {
      transcript: transcript as unknown as object,
      extractedData: extractedData as unknown as object,
      completed: complete,
    },
  });

  // On the phone-capture turn, score the lead and notify founder if hot.
  if (turnNumber === 7) {
    try {
      const scoring = await scoreLeadFromConversation(extractedData);

      await prisma.leadScore.create({
        data: {
          sessionId,
          buyerId: null,
          score: scoring.score,
          temperature: scoring.temperature,
          signals: scoring.signals as unknown as object,
          reasoning: scoring.reasoning,
        },
      });

      // The LeadScore row above stays explicitly unattributed (buyerId: null).
      // A phone-keyed Buyer lookup used to run here and write the score onto the
      // matched buyer, but this route is unauthenticated, un-rate-limited and
      // CSRF-exempt, and `buyers.phone` is non-unique — so `findFirst` returned
      // an arbitrary row and an anonymous caller supplying a known phone number
      // could mutate a different person's record. Attribution belongs on an
      // authenticated path; see docs/plans/BUYER-LOCATION-GAP.md (Fix 4).
      if (extractedData.phone && scoring.temperature === "hot") {
        const hotLead: HotLeadData = {
          firstName: undefined,
          vehicle: describeVehicle(extractedData),
          budget: describeBudget(extractedData),
          timeline: describeTimeline(extractedData.timeline),
          zip: extractedData.zip ?? "Unknown",
          score: scoring.score,
          sessionId,
          phone: extractedData.phone,
        };
        // Founder alert + buyer first-contact SMS run in parallel. Both
        // are best-effort; neither throws out of this block.
        await Promise.all([
          notifyFounderHotLead(hotLead),
          sendHotLeadBuyerSms(hotLead),
        ]);
      }
    } catch (err) {
      // Scoring is non-blocking — buyer still completes the flow.
      logger.error("[api/finder] scoring step failed", err);
    }
  }

  return NextResponse.json({
    nextQuestion,
    extractedData,
    complete,
  });
}
