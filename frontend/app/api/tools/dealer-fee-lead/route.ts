import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { prisma } from "@/lib/prisma";
import { getServiceSupabase } from "@/lib/supabase-service";
import { ContactService } from "@/lib/services/contact.service";
import { sendDealerFeeCalculatorWelcomeEmail } from "@/lib/services/email/resend.service";
import { getStateFeeRules } from "@/lib/tools/dealer-fees";

// Phase C-Tools — public lead capture for the Dealer Fee Calculator.
//
// Buyers who want a custom negotiation strategy submit name + email + buying
// timeline. We create a BuyerOpportunity (source = tool:dealer_fee_calculator),
// segment by timeline into a lead temperature, log TCPA-compliant SMS consent
// ONLY when the buyer explicitly opted in, and fire a welcome email.

type Timeline = "30_days" | "1_3_months" | "3_6_months" | "researching";

const TIMELINE_TO_TEMPERATURE: Record<Timeline, "HOT" | "WARM" | "COLD"> = {
  "30_days": "HOT",
  "1_3_months": "WARM",
  "3_6_months": "WARM",
  researching: "COLD",
};

const TIMELINE_TO_SEGMENT: Record<Timeline, string> = {
  "30_days": "ready_to_buy",
  "1_3_months": "buying_soon",
  "3_6_months": "buying_later",
  researching: "researching",
};

const TIMELINE_LABEL: Record<Timeline, string> = {
  "30_days": "Buying within 30 days",
  "1_3_months": "Buying in 1-3 months",
  "3_6_months": "Buying in 3-6 months",
  researching: "Just researching",
};

function isValidTimeline(v: unknown): v is Timeline {
  return (
    v === "30_days" ||
    v === "1_3_months" ||
    v === "3_6_months" ||
    v === "researching"
  );
}

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
  const vehicleInterest =
    typeof body.vehicleInterest === "string"
      ? body.vehicleInterest.trim()
      : "";
  const state = typeof body.state === "string" ? body.state.trim() : "";
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

  const temperature = TIMELINE_TO_TEMPERATURE[buyerTimeline];
  const segment = TIMELINE_TO_SEGMENT[buyerTimeline];
  const firstName = name.split(/\s+/)[0] || name;
  const stateName = getStateFeeRules(state).stateName;
  const sessionId = `dealer-fee-${randomUUID()}`;

  try {
    // 1) BuyerOpportunity — the canonical lead record for the auction pipeline.
    await prisma.buyerOpportunity.create({
      data: {
        sessionId,
        source: "tool:dealer_fee_calculator",
        firstName,
        email: email.toLowerCase(),
        phone: phone || null,
        timeline: buyerTimeline,
        make: vehicleInterest || null,
        leadTemperature: temperature,
        scoringReason: `Dealer Fee Calculator lead — ${TIMELINE_LABEL[buyerTimeline]}${
          state ? ` · ${stateName}` : ""
        }`,
      },
    });

    // 2) CRM contact upsert — this is also where TCPA SMS consent is logged.
    //    consent_sms / consent_text / consent_ip are only persisted when the
    //    buyer explicitly checked the SMS opt-in box (smsOptIn === true).
    try {
      const supabase = getServiceSupabase();
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
      await ContactService.upsertContact(supabase, {
        email: email.toLowerCase(),
        phone: phone || undefined,
        firstName,
        source: "public_form",
        utmCampaign: "dealer_fee_calculator",
        sourceUrl,
        ipAddress: ip,
        consentEmail: true,
        consentSms: smsOptIn,
        consentText: smsOptIn
          ? "AutoLenis Dealer Fee Calculator — buyer opted in to receive car buying tips by SMS. Msg & data rates apply. Reply STOP to unsubscribe."
          : undefined,
      });
    } catch (crmErr) {
      // A CRM hiccup must never fail the buyer's submission.
      console.error("[dealer-fee-lead] CRM upsert failed:", crmErr);
    }

    // 3) Welcome email — non-blocking; a send failure must not fail the lead.
    try {
      await sendDealerFeeCalculatorWelcomeEmail({
        to: email.toLowerCase(),
        firstName,
        state: stateName,
        segmentLabel: TIMELINE_LABEL[buyerTimeline],
        sessionId,
      });
    } catch (emailErr) {
      console.error("[dealer-fee-lead] welcome email failed:", emailErr);
    }

    return NextResponse.json({ success: true, segment });
  } catch (err) {
    console.error("[dealer-fee-lead]", err);
    return NextResponse.json(
      { success: false, error: "server_error" },
      { status: 500 },
    );
  }
}
