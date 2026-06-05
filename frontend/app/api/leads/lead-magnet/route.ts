import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { prisma } from "@/lib/prisma";
import { getServiceSupabase } from "@/lib/supabase-service";
import { ContactService } from "@/lib/services/contact.service";
import { sendLeadMagnetDeliveryEmail } from "@/lib/services/email/resend.service";
import {
  getLeadMagnet,
  isValidMagnetSlug,
  isValidTimeline,
  segmentForTimeline,
  temperatureForTimeline,
  TIMELINE_LABEL,
} from "@/lib/leads/lead-magnets";

// Phase C-Leads — public lead capture for content lead magnets.
//
// A reader requests a free guide (e.g. "The Car Buyer's Honest Guide"). We:
//   1) create a BuyerOpportunity (source = lead_magnet:<slug>) segmented by
//      timeline into a lead temperature,
//   2) upsert a CRM contact and log TCPA-compliant SMS consent ONLY when the
//      buyer explicitly opted in,
//   3) deliver the guide by email immediately (transactional, idempotent).
//
// Day 1+ nurture is driven by api/cron/lead-magnet-sequence reading these
// BuyerOpportunity records — see lib/services/email/lead-magnet-sequence.ts.

// Timeline-specific opener for the delivery email so each track feels tailored.
const SEGMENT_INTRO: Record<string, string> = {
  ready_to_buy:
    "Since you're buying soon, this guide gets straight to the moves that matter most before you sign.",
  buying_soon:
    "You've got a little time before you buy — perfect for getting the upper hand early.",
  buying_later:
    "Plenty of time to get this right. Start here and you'll walk in knowing more than most buyers ever do.",
  researching:
    "Smart to research first. Here's the honest version of how car pricing really works.",
};

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const buyerTimeline = body.buyerTimeline;
  const magnetSlugInput = body.magnetSlug;
  const vehicleInterest =
    typeof body.vehicleInterest === "string"
      ? body.vehicleInterest.trim()
      : "";
  const smsOptIn = body.smsOptIn === true;
  const sourceUrl =
    typeof body.sourceUrl === "string" ? body.sourceUrl : undefined;

  // ── Validation ──────────────────────────────────────────────────────────
  if (!name) {
    return NextResponse.json(
      { success: false, error: "name_required" },
      { status: 400 },
    );
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { success: false, error: "invalid_email" },
      { status: 400 },
    );
  }
  if (!isValidTimeline(buyerTimeline)) {
    return NextResponse.json(
      { success: false, error: "invalid_timeline" },
      { status: 400 },
    );
  }

  const magnetSlug = isValidMagnetSlug(magnetSlugInput)
    ? magnetSlugInput
    : "honest-guide";
  const magnet = getLeadMagnet(magnetSlug);
  const temperature = temperatureForTimeline(buyerTimeline);
  const segment = segmentForTimeline(buyerTimeline);
  const firstName = name.split(/\s+/)[0] || name;
  const sessionId = `lead-magnet-${randomUUID()}`;
  const accessPath = `${magnet.accessPath}?m=${magnet.slug}`;

  try {
    // 1) BuyerOpportunity — the canonical lead record for the auction pipeline.
    await prisma.buyerOpportunity.create({
      data: {
        sessionId,
        source: `lead_magnet:${magnet.slug}`,
        firstName,
        email: email.toLowerCase(),
        phone: phone || null,
        timeline: buyerTimeline,
        make: vehicleInterest || null,
        leadTemperature: temperature,
        scoringReason: `Lead magnet — ${magnet.title} · ${TIMELINE_LABEL[buyerTimeline]}`,
      },
    });

    // 2) CRM contact upsert — also where TCPA SMS consent is logged. Consent
    //    fields are only persisted when the buyer explicitly checked the box.
    try {
      const supabase = getServiceSupabase();
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
      await ContactService.upsertContact(supabase, {
        email: email.toLowerCase(),
        phone: phone || undefined,
        firstName,
        source: "public_form",
        utmCampaign: magnet.utmCampaign,
        sourceUrl,
        ipAddress: ip,
        consentEmail: true,
        consentSms: smsOptIn,
        consentText: smsOptIn
          ? `AutoLenis lead magnet (${magnet.title}) — buyer opted in to receive car buying tips by SMS. Msg & data rates apply. Reply STOP to unsubscribe.`
          : undefined,
      });
    } catch (crmErr) {
      // A CRM hiccup must never fail the buyer's submission.
      console.error("[lead-magnet] CRM upsert failed:", crmErr);
    }

    // 3) Delivery email — non-blocking; a send failure must not fail the lead.
    try {
      await sendLeadMagnetDeliveryEmail({
        to: email.toLowerCase(),
        firstName,
        magnetTitle: magnet.title,
        magnetDescription: magnet.description,
        bullets: magnet.bullets,
        accessPath,
        segmentIntro: SEGMENT_INTRO[segment] ?? SEGMENT_INTRO.researching,
        sessionId,
      });
    } catch (emailErr) {
      console.error("[lead-magnet] delivery email failed:", emailErr);
    }

    return NextResponse.json({
      success: true,
      segment,
      accessPath,
    });
  } catch (err) {
    console.error("[lead-magnet]", err);
    return NextResponse.json(
      { success: false, error: "server_error" },
      { status: 500 },
    );
  }
}
