// POST /api/public/request-vehicle
//
// Public buyer vehicle-request submission. The form has six sections:
//   1. contact info, 2. vehicle preferences, 3. budget + financing path,
//   4a. need-financing profile  OR  4b. have-financing pre-approval (with
//   optional uploaded letter), 5. trade-in details, 6. notes + consent.
//
// Submissions are persisted as a `Notification` row with `type: SYSTEM_ALERT`
// and a title prefix of `Vehicle Request:` so they show up on the new
// `/admin/vehicle-requests` queue page. Best-effort emails go out to the
// admin and a confirmation to the buyer.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  sendVehicleRequestAdminNotification,
  sendVehicleRequestConfirmation,
} from "@/lib/services/email/vehicle-offers.email";
import {
  sendVehicleRequestReceived,
  sendDealerNewBuyerOpportunityEmail,
} from "@/lib/services/email/resend.service";
import { dispatch } from "@/lib/qstash/dispatch";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function parseBudgetToCents(budget: string): number | null {
  const map: Record<string, number> = {
    "Under $15,000":   1499900,
    "$15,000–$25,000": 2500000,
    "$25,000–$35,000": 3500000,
    "$35,000–$50,000": 5000000,
    "$50,000–$75,000": 7500000,
    "$75,000+":        7500000,
  };
  return map[budget] ?? null;
}

const schema = z.object({
  firstName:           z.string().min(1).max(50),
  lastName:            z.string().min(1).max(50),
  email:               z.string().email(),
  phone:               z.string().min(7).max(20),
  zip:                 z.string().regex(/^\d{5}$/, "ZIP must be 5 digits"),
  // city/state become optional so LP-form submissions (which only collect ZIP)
  // can pass. The full /request-vehicle form still supplies both.
  city:                z.string().max(100).optional().default(""),
  state:               z.string().max(50).optional().default(""),
  contactMethod:       z.enum(["Phone Call", "Text Message", "Email"]).optional().default("Email"),
  timeline:            z.enum(["ASAP", "Within 30 Days", "Within 60 Days", "Just Researching"]),
  vehicleType:         z.enum(["SUV", "Sedan", "Truck", "Van", "Coupe", "Other"]),
  preferredMake:       z.string().max(50).optional(),
  preferredModel:      z.string().max(80).optional(),
  customMakeModel:     z.string().max(100).optional(),
  minYear:             z.number().int().min(2000).max(2030).optional(),
  maxYear:             z.number().int().min(2000).max(2030).optional(),
  newOrUsed:           z.enum(["New", "Used", "Either"]).optional().default("Either"),
  specificFeatures:    z.string().max(500).optional(),
  interiorColor:       z.string().max(100).optional(),
  mustHaveFeatures:    z.string().max(1000).optional(),
  openToAlternatives:  z.boolean().optional().default(false),
  budget:              z.string().min(1).max(100),
  desiredMonthly:      z.string().max(50).optional(),
  downPaymentAvail:    z.string().max(50).optional(),
  financingOption:     z.enum(["need_financing", "have_financing", "no_financing"]).optional().default("no_financing"),
  employmentStatus:    z.string().max(50).optional(),
  employerName:        z.string().max(100).optional(),
  annualIncome:        z.string().max(50).optional(),
  creditScore:         z.string().max(50).optional(),
  downPayment:         z.string().max(50).optional(),
  monthlyPayment:      z.string().max(50).optional(),
  monthlyIncome:       z.string().max(50).optional(),
  housingPayment:      z.string().max(50).optional(),
  coBuyer:             z.boolean().optional(),
  lenderName:          z.string().max(100).optional(),
  approvedAmount:      z.string().max(20).optional(),
  apr:                 z.string().max(10).optional(),
  preApprovalExpiry:   z.string().max(20).optional(),
  hasTradeIn:          z.boolean().optional(),
  tradeYear:           z.string().max(10).optional(),
  tradeMake:           z.string().max(50).optional(),
  tradeModel:          z.string().max(80).optional(),
  tradeTrim:           z.string().max(50).optional(),
  tradeMileage:        z.string().max(20).optional(),
  tradeColor:          z.string().max(30).optional(),
  tradeCondition:      z.string().max(20).optional(),
  tradeVin:            z.string().max(17).optional(),
  tradePaidOff:        z.boolean().optional(),
  tradeLoanBalance:    z.string().max(20).optional(),
  tradePayoffAmount:   z.string().max(20).optional(),
  tradeIssues:         z.string().max(1000).optional(),
  tradeTitleStatus:    z.string().max(30).optional(),
  tradeAccidentHistory: z.string().max(60).optional(),
  notes:               z.string().max(1000).optional(),
  agreedToContact:     z.literal(true),
  // ── LP attribution + consent (optional; populated by /lp/[campaign] form) ──
  utm_source:   z.string().max(100).optional().nullable(),
  utm_medium:   z.string().max(100).optional().nullable(),
  utm_campaign: z.string().max(100).optional().nullable(),
  source_url:   z.string().max(500).optional().nullable(),
  campaign:     z.string().max(60).optional().nullable(),
  consent_email: z.boolean().optional(),
  consent_sms:   z.boolean().optional(),
  // ── Organic SEO attribution (populated by the shared SEO-page form) ────────
  // `source` is a semantic FormSource ("seo_city_frisco", "seo_texas_hub", …)
  // that segments paid vs organic conversions; `referrer` is document.referrer.
  source:   z.string().max(60).optional().nullable(),
  referrer: z.string().max(500).optional().nullable(),
});

type Parsed = z.infer<typeof schema>;

async function uploadPreApproval(file: File): Promise<string | null> {
  if (!ALLOWED_TYPES.includes(file.type) || file.size > MAX_FILE_BYTES) return null;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url, key);
    const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
    const path = `public-requests/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const buffer = await file.arrayBuffer();
    const { error: upErr } = await supabase.storage
      .from("prequal-letters")
      .upload(path, buffer, { contentType: file.type });
    if (upErr) {
      console.error("[request-vehicle] supabase upload error:", upErr);
      return null;
    }
    return supabase.storage.from("prequal-letters").getPublicUrl(path).data.publicUrl;
  } catch (err) {
    console.error("[request-vehicle] upload exception:", err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";

  let raw: unknown;
  let preApprovalFileUrl: string | null = null;

  if (contentType.includes("multipart/form-data")) {
    let fd: FormData;
    try { fd = await request.formData(); } catch {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid form data" } },
        { status: 400 },
      );
    }
    const dataField = fd.get("data");
    try {
      raw = typeof dataField === "string" ? JSON.parse(dataField) : null;
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid data payload" } },
        { status: 400 },
      );
    }
    const file = fd.get("preApprovalFile");
    if (file instanceof File && file.size > 0) {
      preApprovalFileUrl = await uploadPreApproval(file);
    }
  } else {
    try { raw = await request.json(); } catch {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid JSON" } },
        { status: 400 },
      );
    }
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" } },
      { status: 400 },
    );
  }
  const data: Parsed = parsed.data;

  const fullName = `${data.firstName} ${data.lastName}`.trim();

  // ── Find or create buyer account ────────────────────────────────────────
  // VehicleRequest.buyerId is NOT NULL.
  // Resolve the buyer from the submitted email — three cases.
  let buyerId = "";

  try {
    const existingUser = await prisma.user.findUnique({
      where:   { email: data.email.toLowerCase() },
      include: { buyer: { select: { id: true } } },
    });

    if (existingUser?.buyer) {
      // Case 1: Registered buyer — link directly
      buyerId = existingUser.buyer.id;
    } else if (existingUser && !existingUser.buyer) {
      // Case 2: User exists but no buyer profile — create it
      const newBuyer = await prisma.buyer.create({
        data: {
          userId:    existingUser.id,
          firstName: data.firstName,
          lastName:  data.lastName,
          phone:     data.phone  ?? null,
          city:      data.city   ?? null,
          state:     data.state  ?? null,
          zip:       data.zip    ?? null,
        },
      });
      buyerId = newBuyer.id;
    } else {
      // Case 3: No user at all — create guest User + Buyer.
      // User.supabaseId is NOT NULL — use a placeholder replaced at signup.
      const guestUser = await prisma.user.create({
        data: {
          supabaseId: `guest_${crypto.randomUUID()}`,
          email:      data.email.toLowerCase(),
          role:       "BUYER",
        },
      });
      const guestBuyer = await prisma.buyer.create({
        data: {
          userId:    guestUser.id,
          firstName: data.firstName,
          lastName:  data.lastName,
          phone:     data.phone  ?? null,
          city:      data.city   ?? null,
          state:     data.state  ?? null,
          zip:       data.zip    ?? null,
          isGuest:   true,
        },
      });
      buyerId = guestBuyer.id;
    }
  } catch (err) {
    console.error("[request-vehicle] buyer find/create failed:", err);
  }

  // ── Create VehicleRequest record ────────────────────────────────────────
  // This is the canonical record the buyer offer page queries.
  // The Notification below is for the admin queue only.
  let vehicleRequestId: string | undefined;

  if (buyerId) {
    const baseData = {
      buyerId,
      status:          "SUBMITTED" as const,
      makePreference:  data.preferredMake  || null,
      modelPreference: data.preferredModel || null,
      yearMin:         data.minYear ? Number(data.minYear) : null,
      yearMax:         data.maxYear ? Number(data.maxYear) : null,
      maxBudgetCents:  parseBudgetToCents(data.budget),
      notes:           data.notes || null,
      // LP + organic attribution
      utmSource:   data.utm_source   ?? null,
      utmMedium:   data.utm_medium   ?? null,
      utmCampaign: data.utm_campaign ?? null,
      sourceUrl:   data.source_url   ?? null,
      ipAddress:   request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    };
    // `landingSource` (semantic FormSource) + `referrer` require the pending
    // migration (add_landing_source_referrer). Until it is applied, writing
    // those columns throws P2022; we catch and retry WITHOUT them so an organic
    // lead is never lost. Once the migration runs, the first attempt succeeds.
    try {
      const vehicleRequest = await prisma.vehicleRequest.create({
        data: { ...baseData, landingSource: data.source ?? null, referrer: data.referrer ?? null },
      });
      vehicleRequestId = vehicleRequest.id;
    } catch (err) {
      console.warn("[request-vehicle] create with landingSource/referrer failed (migration pending?); retrying without:", err);
      try {
        const vehicleRequest = await prisma.vehicleRequest.create({ data: baseData });
        vehicleRequestId = vehicleRequest.id;
      } catch (err2) {
        console.error("[request-vehicle] VehicleRequest create failed:", err2);
      }
    }
  }

  // ─── CRM PIPELINE — runs after VehicleRequest write ──────────────────────
  // Non-fatal: a CRM sync failure must never block the buyer's submission.
  if (vehicleRequestId) {
    try {
      const { getServiceSupabase } = await import("@/lib/supabase-service");
      const { ContactService } = await import("@/lib/services/contact.service");
      const { WorkflowEngine } = await import("@/lib/services/workflow.engine");
      const supabase = getServiceSupabase();
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;

      // 1. Upsert contact (dedup on email + phone, consent merges upward).
      const contact = await ContactService.upsertContact(supabase, {
        email:        data.email,
        phone:        data.phone,
        firstName:    data.firstName,
        lastName:     data.lastName,
        source:       "public_form",
        utmSource:    data.utm_source   ?? undefined,
        utmMedium:    data.utm_medium   ?? undefined,
        utmCampaign:  data.utm_campaign ?? undefined,
        sourceUrl:    data.source_url   ?? undefined,
        ipAddress:    ip,
        consentEmail: data.consent_email ?? true,  // implied by submission
        consentSms:   data.consent_sms   ?? false,
        consentText:  "AutoLenis Landing Page — vehicle request form",
      });

      // GHL webhook sync — fire-and-forget, must never block the buyer.
      if (process.env.GHL_WEBHOOK_URL) {
        fetch(process.env.GHL_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            phone: data.phone,
            source: 'AutoLenis LP Form',
            tags: [
              'lp-form-submitted',
              `campaign-${data.campaign ?? 'default'}`,
            ],
            customField: {
              zip: data.zip,
              utm_source: data.utm_source ?? null,
              utm_campaign: data.utm_campaign ?? null,
              vehicle_type: data.vehicleType ?? null,
              budget: data.budget ?? null,
              timeline: data.timeline ?? null,
            },
          }),
        }).catch(() => {});
      }

      // 2. Link contact ↔ buyer (polymorphic identity).
      if (buyerId) {
        await ContactService.linkContactIdentity(supabase, contact.id, "buyer", buyerId);
      }

      // 3. Advance lifecycle stage if still a fresh lead. Other stages
      //    (deposit_paid, auction_active, etc.) are not downgraded.
      if (contact.lifecycle_stage === "lead") {
        await ContactService.updateLifecycleStage(
          supabase,
          contact.id,
          "prequal_started",
          null,
        );
      }

      // 4. Timeline note — visible on the admin contact detail page.
      await supabase.from("contact_timeline_events").insert({
        contact_id: contact.id,
        event_type: "note_added",
        event_data: {
          body:
            `Landing page vehicle request submitted. ` +
            `Vehicle: ${data.vehicleType ?? "Not specified"}. ` +
            `Budget: ${data.budget ?? "Not specified"}. ` +
            `Timeline: ${data.timeline ?? "Not specified"}. ` +
            `Campaign: ${data.campaign ?? "organic"}.`,
          source: "lp_form",
          vehicle_request_id: vehicleRequestId,
        },
        created_by: null,
      });

      // 5. Trigger the vehicle_request_submitted workflow (prebuilt sequence).
      //    updateLifecycleStage above only fires triggers mapped in
      //    STAGE_TO_TRIGGER — prequal_started is not mapped, so we call the
      //    workflow engine directly here.
      await WorkflowEngine.triggerForEvent(
        supabase,
        "vehicle_request_submitted",
        contact.id,
        {
          vehicle_type: data.vehicleType,
          budget:       data.budget,
          timeline:     data.timeline,
          campaign:     data.campaign ?? null,
          utm_source:   data.utm_source ?? null,
          vehicle_request_id: vehicleRequestId,
        },
      );
    } catch (crmErr) {
      console.error("[request-vehicle] CRM pipeline sync failed:", crmErr);
    }
  }

  // QStash — kick off the buyer welcome + activation-recovery sequence.
  if (buyerId) {
    dispatch({
      path: "/api/jobs/form-submitted",
      body: {
        buyerId,
        firstName: data.firstName,
        email: data.email,
        phone: data.phone,
        campaign: data.campaign ?? "default",
      },
    }).catch(() => {});
  }

  // Persist as a SYSTEM_ALERT with the standardised "Vehicle Request:" title
  // prefix that /admin/vehicle-requests filters on.
  let notificationId: string | undefined;
  try {
    const created = await prisma.notification.create({
      data: {
        type: "SYSTEM_ALERT",
        channel: "IN_APP",
        title: `Vehicle Request: ${fullName}`,
        body: `${data.vehicleType} · ${data.budget} · ${data.financingOption} · ${data.city}, ${data.state} ${data.zip}`,
        actionUrl: "/admin/vehicle-requests",
        metadata: {
          ...data,
          fullName,
          requestStatus: "new",
          vehicleRequestId: vehicleRequestId ?? null,
          preApprovalFileUrl,
        } as unknown as Parameters<typeof prisma.notification.create>[0]["data"]["metadata"],
      },
    });
    notificationId = created.id;
  } catch (err) {
    console.error("[request-vehicle] notification persist failed:", err);
  }

  await Promise.allSettled([
    sendVehicleRequestAdminNotification({
      fullName,
      email: data.email,
      phone: data.phone,
      zip: data.zip,
      city: data.city,
      state: data.state,
      vehicleType: data.vehicleType,
      preferredMake: data.preferredMake,
      preferredModel: data.preferredModel,
      minYear: data.minYear,
      maxYear: data.maxYear,
      budget: data.budget,
      newOrUsed: data.newOrUsed,
      financingNeeded:
        data.financingOption === "need_financing" ? "Yes" :
        data.financingOption === "have_financing" ? "No" :
        "Not Sure",
      contactMethod: data.contactMethod,
      timeline: data.timeline,
      interiorColor: data.interiorColor,
      mustHaveFeatures: data.mustHaveFeatures,
      openToAlternatives: data.openToAlternatives,
      desiredMonthly: data.desiredMonthly,
      downPaymentAvail: data.downPaymentAvail,
      hasTradeIn: data.hasTradeIn,
      tradeYear: data.tradeYear,
      tradeMake: data.tradeMake,
      tradeModel: data.tradeModel,
      notes: data.notes,
      notificationId,
    }),
    sendVehicleRequestConfirmation(data.email, data.firstName),
  ]);

  // Buyer-side dedicated confirmation (uses unified resend template).
  // Prefer vehicleRequestId so the link resolves to the canonical record.
  const buyerEmailRequestId = vehicleRequestId ?? notificationId ?? "";
  if (buyerEmailRequestId) {
    await sendVehicleRequestReceived(data.email, fullName, buyerEmailRequestId)
      .catch(err => console.error("[request-vehicle] buyer confirmation email failed:", err));
  }

  // Notify active dealers of the new buyer opportunity — non-blocking per dealer.
  if (notificationId) {
    const vehicleInterest = [
      data.preferredMake,
      data.preferredModel,
      data.customMakeModel,
    ].filter(Boolean).join(" ") || data.vehicleType;
    const activeDealers = await prisma.dealer.findMany({
      where: { status: "ACTIVE" },
      include: { user: { select: { email: true } } },
      take: 20,
    }).catch(() => [] as Array<{ id: string; dealershipName: string; user: { email: string } | null }>);
    for (const dealer of activeDealers) {
      if (!dealer.user?.email) continue;
      await sendDealerNewBuyerOpportunityEmail({
        to: dealer.user.email,
        contactName: dealer.dealershipName,
        vehicleInterest,
        buyerCity: data.city,
        buyerState: data.state,
        opportunityUrl: `${APP_URL}/dealer/opportunities`,
        opportunityId: notificationId,
      }).catch(() => { /* silent per-dealer */ });
    }
  }

  return NextResponse.json({ success: true });
}
