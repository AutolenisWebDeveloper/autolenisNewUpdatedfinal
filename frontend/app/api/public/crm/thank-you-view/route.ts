// POST /api/public/crm/thank-you-view
//
// Fire-and-forget endpoint called from the /thank-you page so the
// contact's CRM timeline shows that the deposit-activation CTA was viewed.
// Returns success even when the contact lookup misses (race condition on
// first load — the contact may not have committed yet when the redirect lands).

import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-service";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as {
      email?: unknown;
      campaign?: unknown;
    };
    const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
    const campaign = typeof body.campaign === "string" ? body.campaign : "unknown";
    if (!email) return NextResponse.json({ ok: false }, { status: 400 });

    const supabase = getServiceSupabase();

    const { data: contact } = await supabase
      .from("contacts")
      .select("id")
      .eq("email", email)
      .is("deleted_at", null)
      .maybeSingle();

    if (!contact) {
      return NextResponse.json({ ok: false, reason: "contact_not_found" });
    }

    await supabase.from("contact_timeline_events").insert({
      contact_id: contact.id,
      event_type: "note_added",
      event_data: {
        body: `Visited thank-you page. Campaign: ${campaign}. Deposit activation CTA was shown.`,
        source: "thank_you_page",
      },
      created_by: null,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("[crm/thank-you-view]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
