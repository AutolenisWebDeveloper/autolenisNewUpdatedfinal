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
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  sendVehicleRequestAdminNotification,
  sendVehicleRequestConfirmation,
} from "@/lib/services/email/vehicle-offers.email";
import {
  sendVehicleRequestReceived,
  sendSocialLeadWelcomeEmail,
} from "@/lib/services/email/resend.service";
import { scheduleLifecycleWorkload } from "@/lib/services/crm/lifecycle-scheduler";
import {
  intakeBuyerRequest,
  type UnifiedIntakeInput,
} from "@/lib/services/acquisition/unified-buyer-intake.service";
import { notifyActiveDealersOfOpportunity } from "@/lib/services/acquisition/dealer-opportunity-notification.service";
<<<<<<< HEAD
import { captureClientIp } from "@/lib/services/acquisition/intake-attribution";
=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
import {
  getAttributionFromCookieHeader,
  recordContentAttribution,
} from "@/lib/analytics/content-attribution.server";

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

// The wizard collects make/model either as discrete fields or, on the "other"
// path, as a single free-text "customMakeModel" string (e.g. "Toyota
// Highlander"). Split it so the unified service receives structured make/model.
function splitMakeModel(s?: string): { make?: string; model?: string } {
  const trimmed = (s ?? "").trim();
  if (!trimmed) return {};
  const [make, ...rest] = trimmed.split(/\s+/);
  return { make, model: rest.join(" ") || undefined };
}

// Map the wizard's free-form timeline labels onto the unified intake contract.
const TIMELINE_MAP: Record<
  "ASAP" | "Within 30 Days" | "Within 60 Days" | "Just Researching",
  string
> = {
  "ASAP": "asap",
  "Within 30 Days": "1_month",
  "Within 60 Days": "1_to_3_months",
  "Just Researching": "researching",
};

const schema = z.object({
  firstName:           z.string().min(1).max(50),
  lastName:            z.string().min(1).max(50),
  email:               z.string().email(),
  phone:               z.string().min(7).max(20),
<<<<<<< HEAD
  /**
   * Rule 16 tier 2. The raw token from the emailed claim link, forwarded by the
   * page as `?claim=`. Presenting it is how an unauthenticated caller proves they
   * control the address; without it, an address that belongs to a registered
   * account attaches to nothing.
   */
  claimToken: z.string().min(8).max(200).optional(),

=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
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
  utm_content:  z.string().max(100).optional().nullable(),
  utm_hook:     z.string().max(100).optional().nullable(),
  utm_creator:   z.string().max(100).optional().nullable(),
  utm_affiliate: z.string().max(100).optional().nullable(),
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
      logger.error("[request-vehicle] supabase upload error:", upErr);
      return null;
    }
    // Private bucket: persist the bare storage path, signed at read time by an
    // authorized admin route. Never a public URL.
    return path;
  } catch (err) {
    logger.error("[request-vehicle] upload exception:", err);
    return null;
  }
}

<<<<<<< HEAD
/** The minimum a partial capture must carry to be worth recovering. */
const draftSchema = z.object({
  draft: z.literal(true),
  email: z.string().email(),
  zip: z.string().regex(/^\d{5}$/, "ZIP must be 5 digits"),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  phone: z.string().max(40).optional(),
  /** Free-text "what are you looking for" — the hero asks one question. */
  interest: z.string().max(200).optional(),
  consentSms: z.boolean().optional(),
  utm_source: z.string().max(100).optional().nullable(),
  utm_medium: z.string().max(100).optional().nullable(),
  utm_campaign: z.string().max(100).optional().nullable(),
  utm_content: z.string().max(100).optional().nullable(),
  source_url: z.string().max(500).optional().nullable(),
  referrer: z.string().max(500).optional().nullable(),
  source: z.string().max(100).optional().nullable(),
  /**
   * Rule 16 tier 2. The raw token from the emailed claim link, forwarded by the
   * page as `?claim=`. Presenting it is how an unauthenticated caller proves they
   * control the address; without it, an address that belongs to a registered
   * account attaches to nothing.
   */
  claimToken: z.string().min(8).max(200).optional(),
});

async function handleDraftCapture(request: NextRequest, raw: unknown): Promise<NextResponse> {
  const parsed = draftSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" } },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const clientIp = captureClientIp(request.headers);

  const { buyerOpportunityId, vehicleRequestId, requiresClaim, identityTier } = await intakeBuyerRequest({
    source: "lp_campaign",
    campaign: d.source ?? "hero",
    draft: true,
    claimToken: d.claimToken ?? null,
    firstName: d.firstName,
    lastName: d.lastName,
    email: d.email,
    phone: d.phone,
    zip: d.zip,
    notes: d.interest,
    entryType: "CUSTOM_REQUEST",
    utmSource: d.utm_source ?? null,
    utmMedium: d.utm_medium ?? null,
    utmCampaign: d.utm_campaign ?? null,
    utmContent: d.utm_content ?? null,
    sourceUrl: d.source_url ?? null,
    referrer: d.referrer ?? null,
    landingSource: d.source ?? null,
    ...clientIp,
    consent: {
      surface: d.source ?? "hero",
      granted: { terms: true, email: true, sms: d.consentSms ?? false },
      ip: clientIp.ipAddress,
      ipUnavailableReason: clientIp.ipUnavailableReason,
    },
    appHost: request.headers.get("host"),
  });

  // §6.4 — the four-touch recovery sequence, enqueued on the §27 dispatcher so it
  // survives this request. Best-effort at the CALL SITE only: a visitor's capture
  // must not fail because a reminder could not be scheduled.
  if (vehicleRequestId) {
    try {
      const { enqueueDraftRecovery } = await import("@/lib/services/acquisition/draft-recovery.service");
      await enqueueDraftRecovery({ vehicleRequestId, email: d.email, firstName: d.firstName ?? null });
    } catch (err) {
      logger.error("[request-vehicle] draft recovery enqueue failed (capture stands):", err);
    }
  }

  return NextResponse.json({
    success: true,
    draft: true,
    buyerOpportunityId,
    vehicleRequestId,
    requiresClaim,
    identityTier,
  });
}

=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
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

<<<<<<< HEAD
  // ── DRAFT capture (§5 rule 6) ────────────────────────────────────────────
  // "Incomplete is a draft, never a dead end. Partial submissions persist as DRAFT
  // with whatever was captured, and enter the recovery sequence in §6.4."
  //
  // The homepage hero, the inventory CTA and the article CTAs collect an email, a
  // ZIP and an interest — nowhere near enough for the full schema below, and
  // rejecting them is exactly the dead end the rule forbids. They post here, to
  // THE one handler (§5 rule 1), with `draft: true`, and get a DRAFT Vehicle
  // Request and a four-touch recovery sequence.
  //
  // It is the same endpoint and the same service deliberately. A second "quick
  // capture" route would be a page implementing its own capture logic, which is
  // the thing rule 1 exists to prevent.
  if ((raw as { draft?: unknown } | null)?.draft === true) {
    return handleDraftCapture(request, raw);
  }

=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" } },
      { status: 400 },
    );
  }
  const data: Parsed = parsed.data;

  const fullName = `${data.firstName} ${data.lastName}`.trim();

  // ── Unified buyer intake ─────────────────────────────────────────────────
  // The unified service owns buyer find/create (Case 1/2/3), BuyerOpportunity +
  // VehicleRequest creation, and the Group 3+4A AI pipeline (market enrichment,
  // dealer discovery, phone scripts, lead scoring, 4-channel hot-lead alerts).
  // We no longer touch prisma.vehicleRequest.create directly here.
  const custom = splitMakeModel(data.customMakeModel);

<<<<<<< HEAD
  // Captured once, server-side, and used for both the request row and the consent
  // record — the two must agree about where the submission came from.
  const clientIp = captureClientIp(request.headers);

=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  const input: UnifiedIntakeInput = {
    // /lp/[campaign] submissions carry `campaign`; the plain wizard does not.
    source: data.campaign ? "lp_campaign" : "request_vehicle_wizard",
    campaign: data.campaign ?? undefined,

    firstName: data.firstName,
    lastName:  data.lastName,
    email:     data.email,
    phone:     data.phone,
    zip:       data.zip,

    make:        data.preferredMake  || custom.make,
    model:       data.preferredModel || custom.model,
    vehicleType: data.vehicleType,
    yearMin:     data.minYear,
    yearMax:     data.maxYear,

    // Contract: budgetAmount is in CENTS (the service converts to dollars for
    // BuyerOpportunity and stores cents on VehicleRequest.maxBudgetCents).
    budgetAmount: parseBudgetToCents(data.budget) ?? undefined,
    timeline:     TIMELINE_MAP[data.timeline],

    hasTradeIn: data.hasTradeIn ?? false,
    tradeInDetails: data.hasTradeIn
      ? {
          year:            data.tradeYear,
          make:            data.tradeMake,
          model:           data.tradeModel,
          trim:            data.tradeTrim,
          mileage:         data.tradeMileage,
          color:           data.tradeColor,
          condition:       data.tradeCondition,
          vin:             data.tradeVin,
          paidOff:         data.tradePaidOff,
          loanBalance:     data.tradeLoanBalance,
          payoffAmount:    data.tradePayoffAmount,
          issues:          data.tradeIssues,
          titleStatus:     data.tradeTitleStatus,
          accidentHistory: data.tradeAccidentHistory,
        }
      : undefined,

    financingNeeded: data.financingOption === "need_financing",
    notes:           data.notes,

    utmSource:   data.utm_source   ?? null,
    utmMedium:   data.utm_medium   ?? null,
    utmCampaign: data.utm_campaign ?? null,
    sourceUrl:   data.source_url   ?? null,
    // Organic SEO attribution. `data.source` is the semantic FormSource
    // ("seo_city_frisco", "seo_texas_hub", …) — distinct from UnifiedIntakeInput
    // `source` (the IntakeSource channel). The unified service threads these
    // through to VehicleRequest.landingSource / referrer.
    landingSource: data.source   ?? null,
    referrer:      data.referrer ?? null,
<<<<<<< HEAD

    // ── Phase 2 ─────────────────────────────────────────────────────────────
    utmContent: data.utm_content ?? null,
    // The address is captured SERVER-SIDE from the proxy headers, never from the
    // body — a client-supplied address is not evidence of anything. When no
    // forwarding header is present the column stays NULL and the REASON is
    // recorded in `ip_unavailable_reason`, because a sentinel in an address
    // column is a value that looks like data and is not.
    ...clientIp,
    // §5 rule 4 / §13-D46: one versioned consent record per surface. `granted`
    // carries only what the visitor affirmatively ticked — the submission itself
    // is terms acceptance on this form, and the two channel boxes are opt-in.
    consent: {
      surface: data.source ?? "public_request_vehicle",
      granted: {
        terms: true,
        email: data.consent_email ?? true,
        sms: data.consent_sms ?? false,
      },
      ip: clientIp.ipAddress,
      ipUnavailableReason: clientIp.ipUnavailableReason,
    },
    // §5 rule 3 — location reaches the request and the buyer, not just the lead.
    city: data.city || null,
    state: data.state || null,
    entryType: "CUSTOM_REQUEST",
    appHost: request.headers.get("host"),
    // Rule 16 tier 2: from the emailed claim link, never inferred from the body's
    // email. It is what lets a registered address attach without a session.
    claimToken: data.claimToken ?? null,
  };

  const { buyerOpportunityId, vehicleRequestId, requiresClaim, identityTier } =
=======
  };

  const { buyerOpportunityId, vehicleRequestId } =
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
    await intakeBuyerRequest(input);

  // ── Auto-advance the request toward ACTIVE_SOURCING (non-blocking) ─────────
  // A well-formed submission advances SUBMITTED → INTAKE → ACTIVE_SOURCING,
  // surfacing matched inventory + coverage. Runs after the response is sent;
  // the coverage-hold reconciler cron re-drives any request this best-effort
  // pass fails to advance, so the progression is reliable, not fire-and-forget.
  if (vehicleRequestId) {
    after(async () => {
      try {
        const { advanceVehicleRequest } = await import(
          "@/lib/services/vehicle-request/request-progression.service"
        );
        const r = await advanceVehicleRequest(vehicleRequestId);
        logger.info(`[request-vehicle] progression ${vehicleRequestId}: ${r.from} → ${r.to}`);
      } catch (err) {
        logger.error("[request-vehicle] auto-progression failed:", err);
      }
    });
  }

  // ── Social UTM attribution (non-blocking) ────────────────────────────────
  // If this request came from a social post (utm_source is a social platform),
  // link it back to the SocialPost that drove it. Non-destructive: runs after
  // the response is sent and never throws into the submission flow.
  if (vehicleRequestId && buyerOpportunityId) {
    after(async () => {
      try {
        const { triggerSocialAttribution } = await import(
          "@/lib/social/attribution-hook"
        );
        await triggerSocialAttribution({
          vehicleRequestId,
          buyerOpportunityId,
          utmSource: data.utm_source ?? undefined,
          utmMedium: data.utm_medium ?? undefined,
          utmCampaign: data.utm_campaign ?? undefined,
          utmContent: data.utm_content ?? undefined,
          utmTerm: undefined,
          utmHook: data.utm_hook ?? data.utm_campaign ?? undefined,
          utmPlatform: data.utm_source ?? undefined,
          utmCreator: data.utm_creator ?? undefined,
          utmAffiliate: data.utm_affiliate ?? undefined,
        });
      } catch (err) {
        logger.error("[request-vehicle] attribution failed:", err);
      }
    });
  }

  // ── Social lead capture + welcome email (non-blocking) ───────────────────
  // When a submission arrives from a social platform OR a known social-campaign
  // slug, persist a SocialLead row (the system of record for the social email
  // nurture sequence) and send the social welcome email. Runs after the
  // response is sent; failures never touch the buyer's submission flow.
  {
    const isSocialSource = [
      "facebook", "instagram", "tiktok", "youtube", "linkedin",
    ].includes((data.utm_source ?? "").toLowerCase());

    const isSocialCampaign = [
      "dealer-secret", "price-watch", "market-alert",
      "how-it-works", "dealer-fees", "free-offers",
      "tiktok-dealer", "tiktok-price", "instagram-offer",
    ].some((slug) =>
      (data.campaign ?? "").toLowerCase().includes(slug) ||
      (data.utm_campaign ?? "").toLowerCase().includes(slug),
    );

    const vehicleInterest =
      data.preferredMake && data.preferredModel
        ? `${data.preferredMake} ${data.preferredModel}`
        : null;

    if (isSocialSource || isSocialCampaign) {
      after(async () => {
        try {
          await prisma.socialLead.create({
            data: {
              platform: data.utm_source ?? null,
              franchise: data.utm_content ?? null,
              utmSource: data.utm_source ?? null,
              utmCampaign: data.utm_campaign ?? null,
              utmContent: data.utm_content ?? null,
              utmHook: data.utm_hook ?? null,
              landingPage: data.campaign ?? null,
              firstName: data.firstName ?? "",
              lastName: data.lastName ?? null,
              email: data.email ?? "",
              phone: data.phone ?? null,
              zip: data.zip ?? null,
              city: data.city || null,
              state: data.state || null,
              vehicleInterest,
              make: data.preferredMake ?? null,
              model: data.preferredModel ?? null,
              budget: data.budget ?? null,
              timeline: data.timeline ?? null,
              buyerOpportunityId: buyerOpportunityId ?? null,
              vehicleRequestId: vehicleRequestId ?? null,
              status: "NEW",
            },
          });
          logger.info(
            "[request-vehicle] social lead created for:",
            data.utm_source,
            data.campaign,
          );
        } catch (err) {
          logger.error("[request-vehicle] social lead creation failed:", err);
        }
      });
    }

    if (isSocialSource) {
      after(async () => {
        try {
          await sendSocialLeadWelcomeEmail({
            to: data.email,
            firstName: data.firstName ?? "there",
            vehicleInterest: vehicleInterest ?? undefined,
            campaign: data.campaign ?? data.utm_source ?? "social",
            platform: data.utm_source ?? undefined,
          });
        } catch (err) {
          logger.error("[request-vehicle] social welcome email failed:", err);
        }
      });
    }
  }

  // ── Post-intake pipeline ─────────────────────────────────────────────────
  // Dealer outreach + the dealers-contacted buyer email run in the (Inngest-free)
  // intake pipeline, executed by the intake-reconcile cron via
  // processBuyerOpportunityIntake off the persisted row (intakeProcessedAt IS
  // NULL). No fire-and-forget after() here and no enqueue.

  // Phase C-Attribution — if this request came from a buyer who read a
  // buying-guide article, link the opportunity to that article. No-op when
  // there is no content touch cookie. Best-effort; never blocks submission.
  if (buyerOpportunityId) {
    await recordContentAttribution({
      touch: getAttributionFromCookieHeader(request.headers.get("cookie")),
      source: "web:request_vehicle",
      buyerOpportunityId,
      email: data.email,
    });
  }

  // Resolve the buyerId the unified service stood up, for CRM identity linking
  // and the QStash welcome sequence. When no VehicleRequest was created the
  // buyer could not be resolved (Case C) — degrade gracefully.
  let buyerId = "";
  if (vehicleRequestId) {
    const vr = await prisma.vehicleRequest.findUnique({
      where:  { id: vehicleRequestId },
      select: { buyerId: true },
    });
    buyerId = vr?.buyerId ?? "";
  } else {
    logger.warn(
      "[request-vehicle] unified intake returned no vehicleRequestId — " +
        "skipping CRM linking and VehicleRequest emails",
      { buyerOpportunityId },
    );
  }

  // ─── CRM PIPELINE — runs after VehicleRequest write ──────────────────────
  // Non-fatal: a CRM sync failure must never block the buyer's submission.
  if (vehicleRequestId) {
    try {
      const { getServiceSupabase } = await import("@/lib/supabase-service");
      const { ContactService } = await import("@/lib/services/contact.service");
      const { emitDomainEvent } = await import("@/lib/events/emit");
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

      // 5. Emit the vehicle_request_submitted domain event. This forwards the
      //    signed envelope to Make.com (the orchestration layer) and ALSO drives
      //    the legacy in-app engine while CRM_INAPP_ENGINE_ENABLED === 'true'
      //    (cutover flag) — replacing the prior direct WorkflowEngine call so we
      //    never double-fire once Make scenarios own the sequence.
      await emitDomainEvent("vehicle_request_submitted", {
        domainEntityId: vehicleRequestId,
        supabase,
        contact: {
          email:        data.email,
          phone:        data.phone,
          firstName:    data.firstName,
          lastName:     data.lastName,
          source:       "public_form",
          consentEmail: data.consent_email ?? true,
          consentSms:   data.consent_sms ?? false,
        },
        data: {
          vehicle_type: data.vehicleType,
          make:         data.preferredMake ?? null,
          model:        data.preferredModel ?? null,
          financing_option: data.financingOption ?? null,
          budget:       data.budget,
          timeline:     data.timeline,
          campaign:     data.campaign ?? null,
          utm_source:   data.utm_source ?? null,
          vehicle_request_id: vehicleRequestId,
        },
      });
    } catch (crmErr) {
      logger.error("[request-vehicle] CRM pipeline sync failed:", crmErr);
    }
  }

  // $99 PRE-CHECKOUT conversion — enroll the saved competitive request into the
  // form_submitted → check_form_completion chain that truthfully drives to the
  // $99 checkout (secure resume link). Routed through the lifecycle scheduler
  // (single authority: QStash by default; internal lifecycle_touch once the
  // LIFECYCLE_INTERNAL_FORM_SUBMITTED flag is cut over). Best-effort tail.
  if (buyerId) {
    scheduleLifecycleWorkload({
      workload: "form_submitted",
      buyerId,
      firstName: data.firstName,
      email: data.email,
      phone: data.phone,
      campaign: data.campaign ?? "default",
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
<<<<<<< HEAD
        // §13-D47. This used to be `{ ...data }` — the WHOLE validated form,
        // spread into a notification row: income, employment, credit-band answers,
        // trade payoff amounts and the pre-approval file reference, all sitting in
        // a metadata column with no retention story and no access control beyond
        // the admin list that renders it.
        //
        // The allowlist below is what an admin triaging the queue actually needs:
        // who, what vehicle, where, and the ids to open the real records. Anything
        // financial or personal beyond a name stays in `vehicle_requests` and
        // `pre_qualifications`, which are the records that own it.
        //
        // The PURGE of the rows already written is owner-run against production
        // and is deliberately not attempted here (CLAUDE.md forbids an UPDATE or
        // DELETE against a business table outside the per-run protocol). This
        // change stops the bleeding; D47's second half is the owner's.
        metadata: {
          fullName,
          requestStatus: "new",
          vehicleRequestId: vehicleRequestId ?? null,
          buyerOpportunityId,
          vehicleType: data.vehicleType,
          preferredMake: data.preferredMake ?? null,
          preferredModel: data.preferredModel ?? null,
          city: data.city || null,
          state: data.state || null,
          zip: data.zip,
          timeline: data.timeline,
          hasPreApprovalFile: Boolean(preApprovalFileUrl),
=======
        metadata: {
          ...data,
          fullName,
          requestStatus: "new",
          vehicleRequestId: vehicleRequestId ?? null,
          preApprovalFileUrl,
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
        } as unknown as Parameters<typeof prisma.notification.create>[0]["data"]["metadata"],
      },
    });
    notificationId = created.id;
  } catch (err) {
    logger.error("[request-vehicle] notification persist failed:", err);
  }

  // VehicleRequest-specific emails (admin queue notification + buyer
  // confirmation). These are DISTINCT from the BuyerOpportunity hot-lead
  // notifications fired inside the unified service. Skipped when no
  // VehicleRequest was created (Case C — insufficient buyer info).
  if (vehicleRequestId) {
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
        vehicleRequestId,
      }),
      sendVehicleRequestConfirmation(data.email, data.firstName),
    ]);

    // Buyer-side dedicated confirmation (uses unified resend template).
    // Prefer vehicleRequestId so the link resolves to the canonical record.
    const buyerEmailRequestId = vehicleRequestId ?? notificationId ?? "";
    if (buyerEmailRequestId) {
      await sendVehicleRequestReceived(data.email, fullName, buyerEmailRequestId)
        .catch(err => logger.error("[request-vehicle] buyer confirmation email failed:", err));
    }
  }

  // Notify active dealers of the new buyer opportunity — DEALER-FACING, so it is
  // held behind the $99 pre-activation cost gate (notifyActiveDealersOfOpportunity
  // no-ops until the buyer has an authoritative PAID deposit). Best-effort tail.
  if (notificationId) {
    const vehicleInterest = [
      data.preferredMake,
      data.preferredModel,
      data.customMakeModel,
    ].filter(Boolean).join(" ") || data.vehicleType;
    await notifyActiveDealersOfOpportunity({
      buyerId: buyerId || null,
      opportunityId: notificationId,
      vehicleInterest,
      buyerCity: data.city,
      buyerState: data.state,
    }).catch((err) => logger.error("[request-vehicle] dealer opportunity notify failed:", err));
  }

<<<<<<< HEAD
  // `requiresClaim` is the rule-16 answer the client has to act on. Two cases
  // return it:
  //   • the address belongs to a REGISTERED account and this caller has not proved
  //     they control it, so nothing was attached (identityTier
  //     REGISTERED_REQUIRES_CLAIM, vehicleRequestId null) — the visitor is told to
  //     check their email, NOT shown someone else's request;
  //   • an ordinary guest capture, which is claimed by the same link.
  // The client must never render "your request is in" for the first case.
  return NextResponse.json({
    success: true,
    buyerOpportunityId,
    vehicleRequestId,
    requiresClaim,
    identityTier,
    message: requiresClaim && !vehicleRequestId
      ? "We sent a link to that email address. Open it to finish your request — for your security we do not attach a request to an existing account without it."
      : null,
  });
=======
  return NextResponse.json({ success: true, buyerOpportunityId, vehicleRequestId });
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
}
