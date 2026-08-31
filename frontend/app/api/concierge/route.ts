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

import { logger } from "@/lib/logger";
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
import { promoteOpportunity } from "@/lib/services/acquisition/unified-buyer-intake.service";
import { decideIntakeTurnActions } from "@/lib/services/acquisition/intake-turn";
import { isAiEnabledAsync } from "@/lib/ai/kill-switch";
import { clientIpKey, limitGeneral } from "@/lib/security/rate-limit";
import { recordAiEvent } from "@/lib/services/ai/ai-audit.service";
import {
  SESSION_HANDLE_HEADER,
  isSessionHandleConfigured,
  mintSessionHandle,
  startSession,
  validateGateSubmission,
  verifySessionHandle,
  type ZuraSessionClaims,
} from "@/lib/services/ai/zura-session-handle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ConciergeRequest {
  /**
   * IGNORED. The session id used to come from the browser, which meant the only
   * identity this endpoint had was one an attacker could choose (Phase 2 §5.4).
   * The id now lives inside the server-issued, HMAC-signed handle in the
   * `X-Zura-Session` header. The field is declared here only to document that a
   * stale client sending it changes nothing.
   */
  sessionId?: string;
  userMessage: string;
  firstName?: string; // Sent only on first turn, with the lead gate
  email?: string; // Sent only on first turn, with the lead gate
}

// Per-IP caps. The first is the exact call the (dormant, best-guarded)
// `/api/public/ai/chat` already made; the second bounds the one action on this
// surface that reaches OUTSIDE AutoLenis — promotion into the sourcing pipeline,
// which triggers dealer discovery and outreach.
const TURN_LIMIT = { tokens: 20, window: "1 h" } as const;
const PROMOTION_LIMIT = { tokens: 5, window: "24 h" } as const;
/** Turns one anonymous session may take before it must start a new one. */
const MAX_TURNS_PER_SESSION = 40;

// Lead-gate disclosure shown in the public ChatWidget before name/email is
// collected ("By continuing you agree to receive messages from AutoLenis").
// Recorded verbatim as the CRM consent basis when a contact is captured so the
// opt-in is auditable — consent is never defaulted, only set from this opt-in.
const ZURA_CONSENT_TEXT =
  "AutoLenis public concierge lead gate — by continuing you agree to receive messages from AutoLenis.";

// First client IP for CRM consent provenance (consent_ip is INET). Returns
// undefined when no plausible address is present so the upsert stores NULL
// rather than failing the INET cast.
function getConsentIp(request: NextRequest): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  const candidate = (forwarded ? forwarded.split(",")[0] : request.headers.get("x-real-ip") ?? "").trim();
  // Plausible IPv4/IPv6 only — anything else (e.g. "unknown") is dropped.
  if (/^[0-9.]+$/.test(candidate) || /^[0-9a-fA-F:]+$/.test(candidate)) return candidate;
  return undefined;
}

// CSRF EXEMPTION — a deliberate NON-change (Phase 2 §5.4).
//
// `proxy.ts` exempts this route from CSRF. That stays, and the reason is stated
// here rather than left as an omission: CSRF protects a session-bearing request
// from being forged by another origin. This endpoint has NO authenticated
// session to protect — it is an anonymous public surface — so a CSRF token would
// add a hurdle for legitimate visitors while closing nothing. The controls that
// actually bound abuse here are the per-IP rate limit, the server-issued session
// handle, and the promotion cap below.

const MAX_USER_MESSAGE_LENGTH = 2000;

/**
 * Header telling the client whether THIS session is gate-verified.
 *
 * The handle is opaque, so a client cannot read the claim out of it. Without
 * this the widget cannot tell a gated session from an un-gated one, and a lost
 * turn-1 response would strand a visitor in a session that can never promote —
 * the widget re-sends its gate payload until it sees a "1" here.
 */
const GATE_STATUS_HEADER = "X-Zura-Gate";

/** Attach the session handle and the gate status to every response. */
function withSession(response: Response, handle: string | null, gate: boolean): Response {
  if (handle) response.headers.set(SESSION_HANDLE_HEADER, handle);
  response.headers.set(GATE_STATUS_HEADER, gate ? "1" : "0");
  return response;
}

export async function POST(request: NextRequest) {
  const ip = clientIpKey(request.headers);

  // ── Kill switch, first. A disabled AI must answer 503 AI_DISABLED, not stream
  //    a friendly sentence that hides the outage from an operator.
  if (!(await isAiEnabledAsync())) {
    await recordAiEvent({
      actor: { actorType: "SYSTEM", actorId: `ip:${ip}`, authenticatedRole: null },
      surface: "public-web",
      purpose: "zura.public.concierge",
      outcome: "AI_DISABLED",
      messageLength: 0,
    });
    return new Response("AI_DISABLED", { status: 503 });
  }

  // ── Durable per-IP turn limit. Anonymous and un-rate-limited was the finding;
  //    this is the same limiter the guarded public route already used.
  const rl = await limitGeneral(`zura:public:ip:${ip}`, TURN_LIMIT);
  if (!rl.ok) {
    await recordAiEvent({
      actor: { actorType: "SYSTEM", actorId: `ip:${ip}`, authenticatedRole: null },
      surface: "public-web",
      purpose: "zura.public.concierge",
      outcome: "RATE_LIMITED",
      messageLength: 0,
    });
    return new Response("RATE_LIMITED", { status: 429 });
  }

  let body: ConciergeRequest;
  try {
    body = (await request.json()) as ConciergeRequest;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { userMessage } = body;

  // Captured at request time so the post-stream after() block can attach it as
  // CRM consent provenance (the request object isn't safe to read once the
  // response has flushed).
  const consentIp = getConsentIp(request);

  if (!userMessage || typeof userMessage !== "string") {
    return new Response("userMessage required", { status: 400 });
  }
  if (userMessage.length > MAX_USER_MESSAGE_LENGTH) {
    return new Response("userMessage is too long", { status: 400 });
  }

  // ── Identity. The handle is the ONLY source of the session id; `body.sessionId`
  //    is ignored entirely. A missing or invalid handle starts a NEW session
  //    rather than adopting whatever the caller named.
  if (!isSessionHandleConfigured()) {
    // Fail closed and diagnosably. Proceeding would silently reduce the session
    // control to the client-chosen id this change exists to remove.
    logger.error("[concierge] no ZURA_SESSION_SECRET/CRON_SECRET — refusing to run unauthenticated");
    return new Response("SESSION_NOT_CONFIGURED", { status: 503 });
  }

  const presented = verifySessionHandle(request.headers.get(SESSION_HANDLE_HEADER));

  // The lead gate is validated HERE, server-side. Consent was previously written
  // because an email was merely PRESENT in the body — no validation at all.
  const gateSubmission = validateGateSubmission(body);

  let claims: ZuraSessionClaims;
  let issuedHandle: string | null = null;

  if (presented) {
    claims = presented;
    // A gate accepted on a later turn upgrades the handle, and only the server
    // can mint the upgraded one.
    if (!claims.gate && gateSubmission) {
      claims = { ...claims, gate: true };
      issuedHandle = mintSessionHandle({ sid: claims.sid, gate: true });
    }
  } else {
    const started = startSession(!!gateSubmission);
    if (!started) return new Response("SESSION_NOT_CONFIGURED", { status: 503 });
    claims = started.claims;
    issuedHandle = started.handle;
  }

  const sessionId = claims.sid;

  // Load or create BuyerOpportunity row keyed on the SERVER-issued session id.
  let opportunity = await prisma.buyerOpportunity.findUnique({
    where: { sessionId },
  });

  if (!opportunity) {
    opportunity = await prisma.buyerOpportunity.create({
      data: {
        sessionId,
        messages: [],
        // Only a SERVER-VALIDATED gate submission may seed name/email. An
        // unvalidated body value is discarded.
        firstName: gateSubmission?.firstName ?? null,
        email: gateSubmission?.email ?? null,
      },
    });
  } else if (gateSubmission) {
    // Backfill name/email on an existing row only when they're currently null.
    const patch: { firstName?: string; email?: string } = {};
    if (!opportunity.firstName) patch.firstName = gateSubmission.firstName;
    if (!opportunity.email) patch.email = gateSubmission.email;
    if (Object.keys(patch).length > 0) {
      opportunity = await prisma.buyerOpportunity.update({
        where: { id: opportunity.id },
        data: patch,
      });
    }
  }

  // ── Per-session turn cap. A SECONDARY bound: the per-IP limit above is the
  //    primary one. This counts messages the post-stream block writes, so
  //    concurrent turns in one session can read a stale count and slip past by a
  //    few. That is accepted rather than fixed with new state — the cap exists to
  //    stop one conversation growing without limit, not to be exact, and the IP
  //    limit already bounds the rate at which anyone can try.
  const storedTurnCount = Math.floor(
    ((opportunity.messages as unknown as ConciergeMessage[]) ?? []).length / 2,
  );
  if (storedTurnCount >= MAX_TURNS_PER_SESSION) {
    return withSession(new Response("SESSION_TURN_LIMIT", { status: 429 }), issuedHandle, claims.gate);
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
        logger.error("[concierge] Stream error:", err);
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
      logger.info("[concierge] Extraction completed", {
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
      logger.error("[concierge] STAGE 1 (extraction) FAILED:", err);
      return; // Cannot continue without extraction
    }

    if (!updated) {
      logger.error("[concierge] Extraction returned null — aborting after()");
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
      logger.info("[concierge] STAGE 2 (persist) OK");
    } catch (err) {
      logger.error("[concierge] STAGE 2 (persist) FAILED:", err);
      // Continue to scoring even if persist failed — scoring uses
      // the in-memory profile not the DB
    }

    // Completion + this-turn side-effect decision (the durable pipeline owns
    // the heavy background work; the chat only decides when to trigger it).
    const allCaptured = !!(
      (updated.make || updated.bodyStyle) &&
      (updated.budgetAmount || updated.monthlyPayment) &&
      updated.timeline &&
      updated.zip &&
      updated.phone
    );

    const phoneJustCaptured = !opportunitySnapshot.phone && !!updated.phone;
    const actions = decideIntakeTurnActions({
      allCaptured,
      alreadyCompleted: opportunitySnapshot.completed,
      phoneJustCaptured,
    });

    // Stage 3: completion → mark completed, promote to a sourceable
    // VehicleRequest, and enqueue the durable pipeline. The pipeline
    // (intakeProcessFn) is the single owner of market enrichment, dealer
    // discovery, phone-scripts, scoring, alerts, and outreach — the inline
    // compound searches were retired so there is one discovery path.
    // Promotion is bounded by three independent conditions. Each one only
    // suppresses THE PROMOTION — never the rest of the post-stream work. An
    // early `return` here would silently skip Stage 5 (the CRM contact-plane
    // mirror), which is additive, has its own trigger, and is not what any of
    // these bounds are about.
    let mayPromote = actions.promote;

    // BOUND 1 — promotion requires a SERVER-VERIFIED lead gate. Promotion
    // creates a VehicleRequest and starts dealer discovery and outreach; it is
    // the one action on this anonymous surface that reaches outside AutoLenis,
    // so it must not fire for a visitor who never accepted the disclosure.
    if (mayPromote && !claims.gate) {
      logger.warn("[concierge] promotion skipped — no server-verified lead gate", {
        opportunityId: opportunitySnapshot.id,
      });
      mayPromote = false;
    }

    // BOUND 2 — per-IP daily promotion cap.
    if (mayPromote) {
      const promoteRl = await limitGeneral(`zura:public:promote:${ip}`, PROMOTION_LIMIT);
      if (!promoteRl.ok) {
        logger.warn("[concierge] promotion skipped — per-IP daily cap reached", {
          opportunityId: opportunitySnapshot.id,
        });
        mayPromote = false;
      }
    }

    // BOUND 3 — idempotency. The completion flag flip is a CONDITIONAL update:
    // exactly one writer sees `count === 1`, every replay sees `0`. A replayed
    // `after()` block therefore cannot promote twice. This is the same claim
    // shape the webhook path uses (`updateMany(processed:false→true)`), rather
    // than a new mechanism.
    if (mayPromote) {
      let claimedCompletion = false;
      try {
        const claimed = await prisma.buyerOpportunity.updateMany({
          where: { id: opportunitySnapshot.id, completed: false },
          data: { completed: true },
        });
        claimedCompletion = claimed.count === 1;
        logger.info("[concierge] STAGE 3 (completion flag) OK", { claimed: claimedCompletion });
      } catch (err) {
        logger.error("[concierge] STAGE 3 (completion flag) FAILED:", err);
      }
      if (!claimedCompletion) {
        logger.info("[concierge] promotion already claimed for this opportunity — skipping");
        mayPromote = false;
      }
    }

    if (mayPromote) {
      try {
        await promoteOpportunity(opportunitySnapshot.id, {
          firstName: updated.firstName ?? undefined,
          email: opportunitySnapshot.email ?? undefined,
          phone: updated.phone ?? undefined,
          zip: updated.zip ?? undefined,
          make: updated.make ?? undefined,
          model: updated.model ?? undefined,
          yearMin: updated.yearMin ?? undefined,
          yearMax: updated.yearMax ?? undefined,
          // BuyerOpportunity stores budget in DOLLARS; VehicleRequest wants CENTS.
          budgetAmount:
            updated.budgetAmount != null ? updated.budgetAmount * 100 : undefined,
        });
        logger.info("[concierge] STAGE 3 (promote → VehicleRequest + pipeline) OK");
      } catch (err) {
        logger.error("[concierge] STAGE 3 (promote) FAILED:", err);
      }
    }

    // Stage 4: an early contactable lead (phone captured before the request is
    // complete) needs no explicit trigger. The BuyerOpportunity already exists with
    // intakeProcessedAt IS NULL, so the intake-reconcile cron
    // (processBuyerOpportunityIntake) runs its scoring + hot-lead alerts on the
    // next pass. Intake orchestration is Inngest-free and has one authoritative
    // executor, so there is no creation-time enqueue to race with the cron.

    // The lead just became contactable this turn — mirror it onto the CRM
    // contact plane (additive; the durable pipeline does not own this).
    if (actions.crmCapture) {
      // Stage 5: CRM contact-plane capture (additive, non-blocking).
      // Phone just transitioned null→value, so we now hold a fully contactable
      // lead (gate name/email + in-conversation phone). Mirror it onto the
      // universal contact layer exactly once, following the Phase 1 pattern:
      // ContactService.upsertContact (email→phone dedup) then emitDomainEvent
      // for the Make nurture fan-out. The phoneJustCaptured guard makes this
      // fire a single time per opportunity. A CRM hiccup must never affect the
      // buyer-visible reply, so the whole block is best-effort.
      try {
        const email = opportunitySnapshot.email?.trim().toLowerCase() || null;
        const phone = updated.phone ?? null;
        const firstName = updated.firstName ?? opportunitySnapshot.firstName ?? undefined;

        // Consent comes from the SERVER-VERIFIED gate claim on this session's
        // signed handle — never from the mere presence of an email in the
        // request body, which is what it used to mean. A caller cannot forge the
        // claim, because it is covered by the HMAC.
        const gateOptIn = claims.gate && !!email;

        const { getServiceSupabase } = await import("@/lib/supabase-service");
        const { ContactService } = await import("@/lib/services/contact.service");
        const { emitDomainEvent } = await import("@/lib/events/emit");
        const supabase = getServiceSupabase();

        const contactInput = {
          email,
          phone,
          firstName,
          source: "zura" as const,
          consentEmail: gateOptIn,
          consentSms: gateOptIn,
          consentText: gateOptIn ? ZURA_CONSENT_TEXT : undefined,
          consentIp: gateOptIn ? consentIp : undefined,
        };

        await ContactService.upsertContact(supabase, contactInput);

        await emitDomainEvent("zura_conversation_captured", {
          domainEntityId: opportunitySnapshot.id,
          supabase,
          contact: contactInput,
          data: {
            opportunity_id: opportunitySnapshot.id,
            session_id: opportunitySnapshot.sessionId,
            vehicle: [updated.make, updated.model].filter(Boolean).join(" ") || null,
            body_style: updated.bodyStyle,
            budget_amount: updated.budgetAmount,
            monthly_payment: updated.monthlyPayment,
            timeline: updated.timeline,
            zip: updated.zip,
            has_trade_in: updated.hasTradeIn,
            financing_needed: updated.financingNeeded,
          },
        });
        logger.info("[concierge] STAGE 5 (CRM contact-plane capture) OK");
      } catch (err) {
        logger.error("[concierge] STAGE 5 (CRM contact-plane capture) FAILED:", err);
      }
    }
  });

  // The public surface now writes to the unified AI audit trail like every other
  // Zura surface. Message LENGTH only — never the body; the transcript store is
  // the body of record and has its own retention.
  await recordAiEvent({
    actor: { actorType: "SYSTEM", actorId: `session:${sessionId}`, authenticatedRole: null },
    surface: "public-web",
    purpose: "zura.public.concierge",
    outcome: "ANSWERED",
    messageLength: userMessage.length,
    chatSessionId: sessionId,
  });

  return withSession(
    new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    }),
    issuedHandle,
    claims.gate,
  );
}
