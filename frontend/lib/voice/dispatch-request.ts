// Persist a vehicle request collected by Zura over the phone, then kick off the
// same post-intake flow the web form uses.
//
// Voice dispatch intake: resolve or provision a buyer, then route through the
// unified intake service. Voice collects fewer fields than the web form, so
// everything beyond name/email is optional.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/utils/phone";
import { UserRole } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import twilio from "twilio";
import { scheduleLifecycleWorkload } from "@/lib/services/crm/lifecycle-scheduler";
import {
  intakeBuyerRequest,
  type UnifiedIntakeInput,
} from "@/lib/services/acquisition/unified-buyer-intake.service";
import type { VehicleRequestDraft } from "@/lib/voice/conversation-store";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

// Dual-number tracking. Both Twilio numbers route to the same webhook; the
// number the caller dialed lets us tag the lead's source as toll-free vs local.
const TWILIO_TOLLFREE = "+18662803328";
const TWILIO_LOCAL = "+14695359785";

// Pull a four-digit model year out of a free-form string, or null.
function parseYear(year: string | undefined): number | undefined {
  if (!year) return undefined;
  const match = year.match(/\b(19|20)\d{2}\b/);
  if (!match) return undefined;
  const n = parseInt(match[0], 10);
  return n >= 1980 && n <= 2030 ? n : undefined;
}

// "yes"/"no" → boolean, anything else → undefined.
function parseYesNo(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase().trim();
  if (/^(yes|y|yeah|yep|true)\b/.test(v)) return true;
  if (/^(no|n|nope|false)\b/.test(v)) return false;
  return undefined;
}

// "cash" → false, "financing"/"finance"/"need" → true, else undefined.
function parseFinancing(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  if (v.includes("cash")) return false;
  if (/financ|loan|need/.test(v)) return true;
  return undefined;
}

function adminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

function generateTempPassword(): string {
  return "Buyer@" + crypto.randomBytes(9).toString("hex");
}

// Pull the largest dollar figure out of a free-form budget phrase
// ("thirty thousand", "$25,000", "25k") and return integer cents, or null.
function parseBudgetToCents(budget: string | undefined): number | null {
  if (!budget) return null;
  const matches = budget.match(/\d[\d,]*/g);
  if (!matches) return null;
  const values = matches
    .map((m) => parseInt(m.replace(/,/g, ""), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (values.length === 0) return null;
  return Math.max(...values) * 100;
}

function buildNotes(req: VehicleRequestDraft, callerPhone: string): string {
  const yearRange =
    req.yearMin || req.yearMax
      ? [req.yearMin, req.yearMax].filter(Boolean).join("–")
      : "";
  const lines = [
    "Inbound phone request via Zura voice receptionist.",
    req.newOrUsed ? `Condition: ${req.newOrUsed}.` : "",
    req.vehicleType ? `Vehicle type: ${req.vehicleType}.` : "",
    req.make || req.model
      ? `Vehicle: ${[yearRange, req.make, req.model].filter(Boolean).join(" ")}.`
      : "",
    req.budget ? `Budget: ${req.budget}.` : "",
    req.timeline ? `Timeline: ${req.timeline}.` : "",
    req.zip ? `ZIP: ${req.zip}.` : "",
    req.hasTradeIn ? `Trade-in: ${req.hasTradeIn}.` : "",
    req.financing ? `Financing: ${req.financing}.` : "",
    callerPhone ? `Caller: ${callerPhone}.` : "",
  ].filter(Boolean);
  return lines.join(" ");
}

export interface DispatchResult {
  success: boolean;
  buyerId?: string;
  vehicleRequestId?: string;
  error?: string;
}

export async function dispatchVehicleRequest(
  req: VehicleRequestDraft,
  callerPhone: string,
  inboundNumber?: string,
): Promise<DispatchResult> {
  const firstName = req.firstName?.trim();
  const lastName = req.lastName?.trim();
  const email = req.email?.trim().toLowerCase();

  if (!firstName || !lastName || !email) {
    return { success: false, error: "missing required identity fields" };
  }

  // 1. Resolve or provision the buyer.
  let buyerId = "";
  let createdNewAccount = false;
  let tempPassword = "";

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email },
      include: { buyer: { select: { id: true } } },
    });

    if (existingUser?.buyer) {
      buyerId = existingUser.buyer.id;
    } else if (existingUser && !existingUser.buyer) {
      const buyer = await prisma.buyer.create({
        data: { userId: existingUser.id, firstName, lastName, phone: normalizePhone(callerPhone) || null },
      });
      buyerId = buyer.id;
    } else {
      tempPassword = generateTempPassword();
      const supabase = adminSupabase();
      const { data: created, error: authErr } = await supabase.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { role: "BUYER", source: "voice-receptionist" },
      });
      if (authErr || !created?.user) {
        logger.error("[voice/dispatch] Supabase createUser failed:", authErr?.message);
        return { success: false, error: "could not create buyer account" };
      }
      const supabaseId = created.user.id;
      try {
        const buyer = await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: { supabaseId, email, role: UserRole.BUYER, requiresPasswordChange: true },
          });
          return tx.buyer.create({
            data: { userId: user.id, firstName, lastName, phone: normalizePhone(callerPhone) || null },
          });
        });
        buyerId = buyer.id;
        createdNewAccount = true;
      } catch (dbErr) {
        await supabase.auth.admin.deleteUser(supabaseId).catch(() => {});
        throw dbErr;
      }
    }
  } catch (err) {
    logger.error("[voice/dispatch] buyer resolve/create failed:", err);
    return { success: false, error: "could not resolve buyer" };
  }

  // 2. Hand off to the unified buyer-intake service. The buyer is already
  //    resolved above, so we pass buyerId through; the service creates the
  //    BuyerOpportunity + VehicleRequest (linked) and fires the Group 3+4A AI
  //    pipeline (market enrichment, dealer discovery, phone scripts, lead
  //    scoring, 4-channel hot-lead notifications) in the background.
  // Dual-number tracking: tag the lead source by the number the caller dialed.
  // The unified intake service appends ":campaign" to the source, producing
  // "voice_dispatch:tollfree" or "voice_dispatch:local".
  const numberType =
    inboundNumber === TWILIO_TOLLFREE
      ? "tollfree"
      : inboundNumber === TWILIO_LOCAL
        ? "local"
        : "unknown";

  let vehicleRequestId: string;
  try {
    const input: UnifiedIntakeInput = {
      source: "voice_dispatch",
      campaign: numberType,
      buyerId,
      firstName,
      lastName,
      email,
      phone: callerPhone || undefined,
      zip: req.zip ?? undefined,
      make: req.make ?? undefined,
      model: req.model ?? undefined,
      // Unified intake's vehicleType carries the condition (new/used/either);
      // the spoken body style (SUV/Sedan/…) is captured in the notes instead.
      vehicleType: req.newOrUsed ?? undefined,
      yearMin: parseYear(req.yearMin),
      yearMax: parseYear(req.yearMax),
      // Contract: budgetAmount is in CENTS (parseBudgetToCents returns cents).
      budgetAmount: parseBudgetToCents(req.budget) ?? undefined,
      timeline: req.timeline ?? undefined,
      hasTradeIn: parseYesNo(req.hasTradeIn),
      financingNeeded: parseFinancing(req.financing),
      notes: buildNotes(req, callerPhone),
      utmSource: "voice-receptionist",
    };
    const result = await intakeBuyerRequest(input);
    if (!result.vehicleRequestId) {
      logger.error("[voice/dispatch] unified intake returned no vehicleRequestId");
      return { success: false, buyerId, error: "could not save vehicle request" };
    }
    vehicleRequestId = result.vehicleRequestId;

    // ── Post-intake pipeline ────────────────────────────────────────────────
    // Dealer outreach + the dealers-contacted buyer email run in the (Inngest-free)
    // intake pipeline, executed by the intake-reconcile cron via
    // processBuyerOpportunityIntake off the persisted row. No fire-and-forget
    // after() here and no enqueue — one authoritative executor.
  } catch (err) {
    logger.error("[voice/dispatch] unified intake failed:", err);
    return { success: false, buyerId, error: "could not save vehicle request" };
  }

  // 3. Welcome email for newly provisioned accounts (non-fatal).
  if (createdNewAccount && tempPassword) {
    try {
      const { sendAdminCreatedBuyerEmail } = await import("@/lib/services/email/resend.service");
      await sendAdminCreatedBuyerEmail(email, firstName, tempPassword, `${APP_URL}/auth/signin`);
    } catch (err) {
      logger.error("[voice/dispatch] welcome email failed:", err);
    }
  }

  // 4. CRM sync — never block on it.
  try {
    const { getServiceSupabase } = await import("@/lib/supabase-service");
    const { ContactService } = await import("@/lib/services/contact.service");
    const supabase = getServiceSupabase();

    const contact = await ContactService.upsertContact(supabase, {
      email,
      phone: callerPhone || undefined,
      firstName,
      lastName,
      source: "public_form",
      consentEmail: true,
      consentSms: true, // collected over the phone with the caller
      consentText: "AutoLenis Zura voice receptionist — vehicle request",
    });

    await ContactService.linkContactIdentity(supabase, contact.id, "buyer", buyerId);

    if (contact.lifecycle_stage === "lead") {
      await ContactService.updateLifecycleStage(supabase, contact.id, "prequal_started", null);
    }

    await supabase.from("contact_timeline_events").insert({
      contact_id: contact.id,
      event_type: "note_added",
      event_data: {
        body: buildNotes(req, callerPhone),
        source: "voice-receptionist",
        vehicle_request_id: vehicleRequestId,
      },
      created_by: null,
    });
  } catch (crmErr) {
    logger.error("[voice/dispatch] CRM sync failed:", crmErr);
  }

  // 5. Fire the standard post-intake flow (welcome SMS/email + abandonment
  //    timer). Internal vs QStash is chosen per the form-submitted flag.
  await scheduleLifecycleWorkload({
    workload: "form_submitted",
    buyerId,
    firstName,
    email,
    phone: callerPhone || null,
  });

  return { success: true, buyerId, vehicleRequestId };
}

// Non-vehicle calls (questions, callbacks, dealer inquiries, transfer requests,
// status checks) don't run the dealer-auction pipeline. Instead Zura captures a
// short structured message and we SMS-alert the founder so a human can follow
// up, plus drop a lightweight BuyerOpportunity row for tracking/reporting.
export interface FounderMessageAlertInput {
  callReason: string;
  callerPhone: string;
  inboundNumber?: string;
  messageDetails: {
    callerName?: string | null;
    callerEmail?: string | null;
    reason?: string | null;
    bestCallbackTime?: string | null;
    dealership?: string | null;
    location?: string | null;
  };
}

export async function sendFounderMessageAlert(
  input: FounderMessageAlertInput,
): Promise<void> {
  const numberType =
    input.inboundNumber === TWILIO_TOLLFREE
      ? "toll-free"
      : input.inboundNumber === TWILIO_LOCAL
        ? "local"
        : "unknown";

  // Format SMS message
  const reasonLabels: Record<string, string> = {
    question: "Question",
    status_check: "Status Check",
    message: "Callback Request",
    dealer_inquiry: "DEALER INQUIRY",
    transfer_request: "Wants to Talk to Marc",
    other: "Other",
  };

  const label = reasonLabels[input.callReason] ?? "Call";

  const smsBody = [
    `🔔 ${label} (${numberType})`,
    `From: ${input.messageDetails.callerName ?? "Unknown"}`,
    `Phone: ${input.callerPhone}`,
    input.messageDetails.callerEmail && `Email: ${input.messageDetails.callerEmail}`,
    input.messageDetails.dealership && `Dealership: ${input.messageDetails.dealership}`,
    input.messageDetails.location && `Location: ${input.messageDetails.location}`,
    input.messageDetails.reason && `Reason: ${input.messageDetails.reason}`,
    input.messageDetails.bestCallbackTime &&
      `Best time: ${input.messageDetails.bestCallbackTime}`,
  ]
    .filter(Boolean)
    .join("\n");

  // Send SMS to founder using the existing Twilio client pattern.
  try {
    const founderPhone = process.env.FOUNDER_PHONE_NUMBER;
    // Prefer the dedicated TWILIO_PHONE_NUMBER, but fall back to the
    // TWILIO_FROM_NUMBER the rest of the app already sends from.
    const fromPhone = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM_NUMBER;

    if (!founderPhone || !fromPhone) {
      logger.error(
        "[founder-alert] Missing FOUNDER_PHONE_NUMBER or TWILIO_PHONE_NUMBER/TWILIO_FROM_NUMBER",
      );
      return;
    }

    if (founderPhone === fromPhone) {
      logger.error("[founder-alert] FOUNDER_PHONE_NUMBER cannot equal the Twilio from number");
      return;
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      logger.error("[founder-alert] Missing Twilio credentials");
      return;
    }

    const twilioClient = twilio(accountSid, authToken);
    await twilioClient.messages.create({
      from: fromPhone,
      to: founderPhone,
      body: smsBody,
    });

    logger.info(`[founder-alert] SMS sent for ${input.callReason}`);
  } catch (err) {
    logger.error(`[founder-alert] Failed: ${err instanceof Error ? err.message : err}`);
  }

  // Also create a BuyerOpportunity record (lightweight) for tracking. The
  // caller's stated reason is kept in the messages JSON (BuyerOpportunity has
  // no dedicated notes column — that lives on VehicleRequest).
  try {
    const sourceSuffix =
      numberType === "toll-free" ? "tollfree" : numberType === "local" ? "local" : "unknown";
    await prisma.buyerOpportunity.create({
      data: {
        sessionId: crypto.randomUUID(),
        source: `voice_dispatch:${sourceSuffix}`,
        callReason: input.callReason,
        phone: input.callerPhone,
        firstName: input.messageDetails.callerName ?? null,
        email: input.messageDetails.callerEmail ?? null,
        completed: true,
        messages: input.messageDetails.reason
          ? [{ role: "caller", content: input.messageDetails.reason }]
          : [],
      },
    });
  } catch (err) {
    logger.error(
      `[founder-alert] BuyerOpportunity create failed: ${err instanceof Error ? err.message : err}`,
    );
  }
}
