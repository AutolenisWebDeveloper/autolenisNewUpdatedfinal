import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { parseTwilioRequest } from "@/lib/voice/twilio-verify";
import {
  getConversation,
  updateConversation,
  clearConversation,
  type VehicleRequestDraft,
  type VoiceConversation,
} from "@/lib/voice/conversation-store";
import {
  dispatchVehicleRequest,
  sendFounderMessageAlert,
} from "@/lib/voice/dispatch-request";
import { dispatch } from "@/lib/qstash/dispatch";
import { isValidUsPhone } from "@/lib/services/sms/twilio.service";
import { sendTransactionalSmsIfAllowed } from "@/lib/voice/transactional-sms";
import { normalizePhone } from "@/lib/utils/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/api/twilio/voice/status";

// Twilio call statuses that mean the call has ended.
const TERMINAL_STATUSES = new Set(["completed", "failed", "no-answer", "busy", "canceled"]);

// Dual-number tracking — mirror dispatch-request.ts so the summary email can
// name which line the caller dialed.
const TWILIO_TOLLFREE = "+18662803328";
const TWILIO_LOCAL = "+14695359785";

// Human-readable label for each classified call reason.
const CALL_REASON_LABELS: Record<string, string> = {
  vehicle_request: "Vehicle request",
  question: "Question",
  status_check: "Status check",
  message: "Callback request",
  dealer_inquiry: "Dealer inquiry",
  transfer_request: "Wants to talk to Marc",
  other: "Other",
};

function lineLabel(inboundNumber: string | undefined): string {
  if (inboundNumber === TWILIO_TOLLFREE) return "toll-free line";
  if (inboundNumber === TWILIO_LOCAL) return "local line";
  return "unknown line";
}

// Merge new tags onto the contact row without clobbering existing ones.
async function tagContact(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  contactId: string,
  existing: string[] | null | undefined,
  newTags: string[],
): Promise<void> {
  const tags = new Set([...(existing ?? []), ...newTags]);
  await supabase.from("contacts").update({ tags: [...tags] }).eq("id", contactId);
}

async function sendInternalAlert(subject: string, body: string): Promise<void> {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  if (!to || !apiKey || apiKey.includes("placeholder")) return;
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: `${process.env.FROM_NAME ?? "AutoLenis"} <noreply@autolenis.com>`,
      to,
      subject,
      html: `<pre style="font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap">${escapeHtml(
        body,
      )}</pre>`,
    });
  } catch (err) {
    logger.error("[voice/status] internal alert failed:", err);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Render the full call transcript (caller + Zura turns) so the founder can read
// exactly what was said. Returns a "(no conversation captured)" placeholder for
// calls that ended before the caller spoke.
function formatTranscript(conv: VoiceConversation | null): string {
  const history = conv?.history ?? [];
  if (history.length === 0) return "(no conversation captured)";
  return history
    .map((m) => `${m.role === "user" ? "Caller" : "Zura"}: ${m.content}`)
    .join("\n");
}

// Build the complete inbound-call summary the founder receives by email. Unlike
// the old five-field version, this surfaces the call reason, every vehicle and
// message field that was captured, and the full transcript, so the reason for
// the call is always clear — even for questions, dealer inquiries, and
// callbacks that never touched the vehicle pipeline.
function buildCallSummary(
  conv: VoiceConversation | null,
  callerPhone: string,
  callDuration: string,
  callStatus: string,
): { subject: string; body: string } {
  const vr = conv?.vehicleRequest ?? null;
  const md = conv?.messageDetails ?? {};
  const reason = conv?.callReason;
  const reasonLabel = reason ? CALL_REASON_LABELS[reason] ?? "Call" : "Uncategorized call";

  const name = [vr?.firstName, vr?.lastName].filter(Boolean).join(" ") || md.callerName || "";
  const email = vr?.email || md.callerEmail || "";
  const vehicle = [vr?.yearMin, vr?.yearMax && vr?.yearMax !== vr?.yearMin ? vr?.yearMax : null, vr?.make, vr?.model]
    .filter(Boolean)
    .join(" ");

  const lines: string[] = [
    `Call reason: ${reasonLabel}`,
    `From: ${callerPhone || "unknown"} (${lineLabel(conv?.inboundNumber)})`,
    `Duration: ${callDuration}s`,
    `Call status: ${callStatus}`,
    "",
    "── Caller ──",
    `Name: ${fieldOrDash(name)}`,
    `Email: ${fieldOrDash(email)}`,
  ];

  // Vehicle block — shown when there's a vehicle intent or any vehicle field.
  const hasVehicleData =
    reason === "vehicle_request" ||
    !reason ||
    !!(vr && (vr.make || vr.model || vr.budget || vr.timeline || vr.zip || vr.vehicleType));
  if (hasVehicleData) {
    lines.push(
      "",
      "── Vehicle request ──",
      `Vehicle: ${fieldOrDash(vehicle)}`,
      `Type: ${fieldOrDash(vr?.vehicleType)}`,
      `Condition: ${fieldOrDash(vr?.newOrUsed)}`,
      `Budget: ${fieldOrDash(vr?.budget)}`,
      `Timeline: ${fieldOrDash(vr?.timeline)}`,
      `ZIP: ${fieldOrDash(vr?.zip)}`,
      `Trade-in: ${fieldOrDash(vr?.hasTradeIn)}`,
      `Financing: ${fieldOrDash(vr?.financing)}`,
    );
  }

  // Message block — shown for non-vehicle calls or whenever details exist.
  const hasMessageData = !!(md.reason || md.bestCallbackTime || md.dealership || md.location);
  if (hasMessageData) {
    lines.push(
      "",
      "── Message details ──",
      `Reason: ${fieldOrDash(md.reason ?? undefined)}`,
      `Dealership: ${fieldOrDash(md.dealership ?? undefined)}`,
      `Location: ${fieldOrDash(md.location ?? undefined)}`,
      `Best callback time: ${fieldOrDash(md.bestCallbackTime ?? undefined)}`,
    );
  }

  lines.push("", "── Transcript ──", formatTranscript(conv));

  return {
    subject: `AutoLenis — inbound call: ${reasonLabel}${name ? ` from ${name}` : ""}`,
    body: lines.join("\n"),
  };
}

// Confirmation email to a caller who left an email address before hanging up.
async function sendCallerThankYouEmail(email: string, firstName: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes("placeholder")) return;
  const name = firstName.trim() || "there";
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: `${process.env.FROM_NAME ?? "AutoLenis"} <noreply@autolenis.com>`,
      to: email,
      subject: "Thanks for calling AutoLenis",
      text:
        `Hi ${name} — thanks for calling AutoLenis today.\n\n` +
        `We captured your information and a team member will follow up with you shortly.\n\n` +
        `Ready to get started? Submit your vehicle request at autolenis.com and let verified dealers compete for your business.\n\n` +
        `AutoLenis Team\nsupport@autolenis.com\nMonday–Friday 9AM–6PM CT`,
    });
  } catch (err) {
    logger.error("[voice/status] caller email failed:", err);
  }
}

function fieldOrDash(value: string | undefined): string {
  return value && value.trim() ? value.trim() : "—";
}

// Minimum fields needed to fire the vehicle-intake pipeline. dispatch itself
// re-validates required identity fields before persisting.
function isVehicleRequestComplete(draft: VehicleRequestDraft | undefined | null): boolean {
  if (!draft) return false;
  return !!(draft.firstName && draft.email && draft.make && draft.model);
}

export async function POST(request: NextRequest) {
  try {
    const { params, verified } = await parseTwilioRequest(request, PATH);
    // Twilio expects a 200 on status callbacks; on a bad signature we acknowledge
    // but skip all side effects rather than acting on unverified data.
    if (!verified) {
      return new Response("", { status: 200 });
    }

    const callSid = params.CallSid ?? "";
    const callStatus = params.CallStatus ?? "";
    const from = params.From ?? "";
    const callDuration = params.CallDuration ?? "0";

    if (!TERMINAL_STATUSES.has(callStatus)) {
      return new Response("", { status: 200 });
    }

    const conv = callSid ? getConversation(callSid) : null;
    const vr: VehicleRequestDraft | null = conv?.vehicleRequest ?? null;
    const callerPhone = (conv?.callerPhone || from || "").trim();

    // FIX 2 — caller confirmation. If nothing was captured mid-call, send the
    // confirmation SMS now and dispatch the lead with whatever data we have.
    if (callSid && conv && callerPhone && !conv.partialLeadDispatched) {
      updateConversation(callSid, { partialLeadDispatched: true });
      if (isValidUsPhone(callerPhone)) {
        await sendTransactionalSmsIfAllowed(
          callerPhone,
          "Hi! Thanks for calling AutoLenis. A team member will follow up with you shortly. Questions? Visit autolenis.com Reply STOP to opt out.",
        );
      }
      await dispatch({
        path: "/api/jobs/form-submitted",
        body: {
          firstName: vr?.firstName ?? "",
          lastName: vr?.lastName ?? "",
          email: vr?.email ?? "",
          phone: callerPhone,
          campaign: "phone-voice-abandoned",
        },
      });
    }

    // FIX 3a — persist whatever the caller gave us to the CRM, even partial data.
    try {
      const { getServiceSupabase } = await import("@/lib/supabase-service");
      const { ContactService } = await import("@/lib/services/contact.service");
      const supabase = getServiceSupabase();

      const phone = normalizePhone(callerPhone);
      if (phone || vr?.email) {
        const contact = await ContactService.upsertContact(supabase, {
          phone: phone || undefined,
          email: vr?.email || undefined,
          firstName: vr?.firstName || undefined,
          lastName: vr?.lastName || undefined,
          source: "public_form",
        });
        await tagContact(supabase, contact.id, contact.tags, [
          "inbound-call",
          "partial-voice-request",
        ]);
        await supabase.from("contact_timeline_events").insert({
          contact_id: contact.id,
          event_type: "note_added",
          event_data: {
            body: `Inbound call (${callStatus}) — duration ${callDuration} seconds. Vehicle: ${fieldOrDash(
              [vr?.make, vr?.model].filter(Boolean).join(" "),
            )}, budget ${fieldOrDash(vr?.budget)}, timeline ${fieldOrDash(vr?.timeline)}.`,
            source: "voice-receptionist",
          },
          created_by: null,
        });
      }
    } catch (err) {
      logger.error("[voice/status] CRM update failed:", err);
    }

    // FIX 3b — confirmation email when the caller left an address.
    if (vr?.email) {
      await sendCallerThankYouEmail(vr.email, vr.firstName ?? "");
    }

    // End-of-call dispatch routing. Vehicle requests run the dealer-auction
    // pipeline; every other classified intent SMS-alerts the founder. Both are
    // guarded so a duplicate status callback can't double-fire. An unclassified
    // call (callReason undefined) is treated as a vehicle request to preserve
    // legacy capture behavior.
    if (callSid && conv) {
      const callReason = conv.callReason;
      const isVehicleIntent = !callReason || callReason === "vehicle_request";

      if (isVehicleIntent) {
        if (!conv.requestDispatched && isVehicleRequestComplete(conv.vehicleRequest)) {
          updateConversation(callSid, { requestDispatched: true });
          await dispatchVehicleRequest(
            conv.vehicleRequest!,
            conv.callerPhone || from,
            conv.inboundNumber,
          ).catch((err) => logger.error("[voice/status] late dispatch failed:", err));
        }
      } else if (!conv.founderAlertSent) {
        updateConversation(callSid, { founderAlertSent: true });
        await sendFounderMessageAlert({
          callReason,
          callerPhone: conv.callerPhone || from,
          inboundNumber: conv.inboundNumber,
          messageDetails: conv.messageDetails ?? {},
        }).catch((err) => logger.error("[voice/status] founder alert failed:", err));
      }
    }

    // FIX 4 — internal alert to admin with the full set of collected data:
    // call reason, every captured vehicle/message field, and the transcript.
    const summary = buildCallSummary(conv, callerPhone || from, callDuration, callStatus);
    await sendInternalAlert(summary.subject, summary.body);

    if (callSid) clearConversation(callSid);

    return new Response("", { status: 200 });
  } catch (err) {
    // Status callbacks must always return 200 — Twilio retries non-2xx and the
    // call has already ended, so there is nothing for the caller to recover.
    logger.error("Voice status error:", err);
    return new Response("", { status: 200 });
  }
}
