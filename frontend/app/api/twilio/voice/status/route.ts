import { NextRequest } from "next/server";
import { parseTwilioRequest } from "@/lib/voice/twilio-verify";
import { getConversation, clearConversation } from "@/lib/voice/conversation-store";
import { dispatchVehicleRequest } from "@/lib/voice/dispatch-request";
import { normalizePhone } from "@/lib/utils/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/api/twilio/voice/status";

// Append a tag to the contact row without clobbering existing tags.
async function tagContact(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  contactId: string,
  existing: string[] | null | undefined,
  tag: string,
): Promise<void> {
  const tags = new Set([...(existing ?? []), tag]);
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

  if (callStatus !== "completed" && callStatus !== "failed") {
    return new Response("", { status: 200 });
  }

  const conv = callSid ? getConversation(callSid) : null;

  try {
    const { getServiceSupabase } = await import("@/lib/supabase-service");
    const { ContactService } = await import("@/lib/services/contact.service");
    const supabase = getServiceSupabase();

    const phone = normalizePhone(from);
    if (phone) {
      const contact = await ContactService.upsertContact(supabase, {
        phone,
        source: "public_form",
      });
      await tagContact(supabase, contact.id, contact.tags, "inbound-call");
      await supabase.from("contact_timeline_events").insert({
        contact_id: contact.id,
        event_type: "note_added",
        event_data: {
          body: `Inbound call duration: ${callDuration} seconds (status: ${callStatus}).`,
          source: "voice-receptionist",
        },
        created_by: null,
      });
    }
  } catch (err) {
    console.error("[voice/status] CRM update failed:", err);
  }

  // Capture a vehicle request that was collected but never dispatched mid-call
  // (e.g. the caller hung up right after the last detail).
  if (conv?.vehicleRequest && !conv.requestDispatched) {
    await dispatchVehicleRequest(conv.vehicleRequest, conv.callerPhone || from).catch((err) =>
      console.error("[voice/status] late dispatch failed:", err),
    );
  }

  await sendInternalAlert(
    `Inbound call from ${from}\nDuration: ${callDuration}s\nStatus: ${callStatus}`,
  );

  if (callSid) clearConversation(callSid);

  return new Response("", { status: 200 });
}
