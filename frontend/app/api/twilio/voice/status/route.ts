import { NextRequest } from "next/server";
import { parseTwilioRequest } from "@/lib/voice/twilio-verify";
import {
  getConversation,
  updateConversation,
  clearConversation,
  type VehicleRequestDraft,
} from "@/lib/voice/conversation-store";
import { dispatchVehicleRequest } from "@/lib/voice/dispatch-request";
import { dispatch } from "@/lib/qstash/dispatch";
import { sendSms, isValidUsPhone } from "@/lib/services/sms/twilio.service";
import { normalizePhone } from "@/lib/utils/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/api/twilio/voice/status";

// Twilio call statuses that mean the call has ended.
const TERMINAL_STATUSES = new Set(["completed", "failed", "no-answer", "busy", "canceled"]);

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

async function sendInternalAlert(body: string): Promise<void> {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  if (!to || !apiKey || apiKey.includes("placeholder")) return;
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: `${process.env.FROM_NAME ?? "AutoLenis"} <noreply@autolenis.com>`,
      to,
      subject: "AutoLenis — inbound call summary",
      html: `<pre style="font-family:ui-monospace,monospace;font-size:13px">${body}</pre>`,
    });
  } catch (err) {
    console.error("[voice/status] internal alert failed:", err);
  }
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
    console.error("[voice/status] caller email failed:", err);
  }
}

function fieldOrDash(value: string | undefined): string {
  return value && value.trim() ? value.trim() : "—";
}

export async function POST(request: NextRequest) {
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
      await sendSms(
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
    console.error("[voice/status] CRM update failed:", err);
  }

  // FIX 3b — confirmation email when the caller left an address.
  if (vr?.email) {
    await sendCallerThankYouEmail(vr.email, vr.firstName ?? "");
  }

  // Capture a *complete* vehicle request that was collected but never dispatched
  // mid-call (e.g. the caller hung up right after the last detail).
  if (conv?.vehicleRequest && !conv.requestDispatched) {
    await dispatchVehicleRequest(conv.vehicleRequest, conv.callerPhone || from).catch((err) =>
      console.error("[voice/status] late dispatch failed:", err),
    );
  }

  // FIX 4 — internal alert to admin with the full set of collected data.
  await sendInternalAlert(
    [
      `Inbound call from ${callerPhone || from || "unknown"}`,
      `Duration: ${callDuration}s`,
      `Data collected:`,
      `Name: ${fieldOrDash([vr?.firstName, vr?.lastName].filter(Boolean).join(" "))}`,
      `Email: ${fieldOrDash(vr?.email)}`,
      `Vehicle: ${fieldOrDash([vr?.make, vr?.model].filter(Boolean).join(" "))}`,
      `Budget: ${fieldOrDash(vr?.budget)}`,
      `Timeline: ${fieldOrDash(vr?.timeline)}`,
    ].join("\n"),
  );

  if (callSid) clearConversation(callSid);

  return new Response("", { status: 200 });
}
