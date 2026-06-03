// POST /api/public/phone-request
//
// Server-to-server intake for vehicle requests collected by the GoHighLevel
// AI phone receptionist. GHL POSTs the structured call result here; the route
// hands the submission to the unified buyer-intake service, which resolves (or
// provisions a guest) buyer, persists a BuyerOpportunity + VehicleRequest, and
// fires the Group 3+4A AI pipeline (market enrichment, dealer discovery, phone
// scripts, lead scoring, 4-channel hot-lead notifications). This route then
// layers the CRM sync + welcome-sequence dispatch on top, and upgrades net-new
// guest buyers into full Supabase login accounts (the credential email).
//
// Auth is a shared secret in the `X-GHL-Secret` header — this endpoint is not
// browser-facing, so there is no cookie/session involved.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { sendAdminCreatedBuyerEmail } from "@/lib/services/email/resend.service";
import { dispatch } from "@/lib/qstash/dispatch";
import {
  intakeBuyerRequest,
  type UnifiedIntakeInput,
} from "@/lib/services/acquisition/unified-buyer-intake.service";
import crypto from "crypto";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

// ── Rate limit: 100 requests / hour, keyed by caller IP ──────────────────────
// In-memory state is per server instance and resets on cold start — adequate
// abuse mitigation for a secret-gated server-to-server endpoint.
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  if (rateLimitBuckets.size > 1000) {
    for (const [key, b] of rateLimitBuckets) {
      if (b.resetAt < now) rateLimitBuckets.delete(key);
    }
  }
  const bucket = rateLimitBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateLimitBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count += 1;
  return true;
}

// Constant-time secret comparison to avoid leaking length/prefix via timing.
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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

// GHL may send budget as a free-form string ("$35,000", "$25k–$35k") or as a
// numeric value. Strings are dollars → convert to integer cents; numbers are
// assumed to already be cents (matching the unified intake contract).
function parseGhlBudgetToCents(
  budget: string | number | undefined,
): number | undefined {
  if (budget == null) return undefined;
  if (typeof budget === "number") {
    return Number.isFinite(budget) && budget > 0 ? budget : undefined;
  }
  const digits = budget.replace(/[^0-9]/g, "");
  if (!digits) return undefined;
  return Math.round(Number(digits) * 100); // dollars → cents
}

// GHL sends timeline as free-form text ("ASAP", "this week", "1 month",
// "just looking"). Normalize to the labels the unified intake contract uses.
function normalizePhoneTimeline(t: string | undefined): string | undefined {
  if (!t) return undefined;
  const lower = t.toLowerCase().trim();
  if (lower.includes("asap") || lower.includes("immediate")) return "asap";
  if (lower.includes("week")) return "this_week";
  if (lower.includes("month")) return "1_month";
  if (lower.includes("research") || lower.includes("just looking")) {
    return "researching";
  }
  return lower; // pass through
}

function parseYear(year: string): number | undefined {
  const n = parseInt(year, 10);
  return Number.isFinite(n) && n >= 1980 && n <= 2030 ? n : undefined;
}

const schema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  email: z.string().email(),
  phone: z.string().min(7).max(20),
  zip: z.string().regex(/^\d{5}$/, "ZIP must be 5 digits"),
  newOrUsed: z.string().min(1).max(20),
  make: z.string().min(1).max(50),
  model: z.string().min(1).max(80),
  year: z.string().min(1).max(10),
  trim: z.string().max(50).optional().default(""),
  color: z.string().max(30).optional().default(""),
  budget: z.string().min(1).max(100),
  financing: z.string().min(1).max(50),
  hasTradeIn: z.boolean(),
  timeline: z.string().min(1).max(50),
  source: z.literal("phone-receptionist"),
});

type Parsed = z.infer<typeof schema>;

function buildNotes(data: Parsed): string {
  const lines = [
    `Phone request via GHL AI receptionist.`,
    `Vehicle: ${data.year} ${data.make} ${data.model}${data.trim ? ` ${data.trim}` : ""} (${data.newOrUsed}).`,
    data.color ? `Color: ${data.color}.` : "",
    `Budget: ${data.budget}.`,
    `Financing: ${data.financing}.`,
    `Trade-in: ${data.hasTradeIn ? "Yes" : "No"}.`,
    `Timeline: ${data.timeline}.`,
  ].filter(Boolean);
  return lines.join(" ");
}

// Map GHL's vehicle condition phrasing onto the unified intake vehicleType
// contract ("new" | "used" | "open"). Unknown values pass through lowercased.
function mapVehicleType(newOrUsed: string): string {
  const v = newOrUsed.toLowerCase().trim();
  if (v.includes("new")) return "new";
  if (v.includes("used") || v.includes("pre-owned") || v.includes("preowned")) {
    return "used";
  }
  if (v.includes("either") || v.includes("open") || v.includes("any")) {
    return "open";
  }
  return v;
}

export async function POST(request: NextRequest) {
  // 1. Shared-secret auth. SECURITY GATE — must run before any business logic.
  const expected = process.env.GHL_PHONE_REQUEST_SECRET;
  if (!expected) {
    console.error("[phone-request] GHL_PHONE_REQUEST_SECRET is not configured");
    return NextResponse.json(
      { success: false, error: { code: "NOT_CONFIGURED", message: "Endpoint not configured" } },
      { status: 503 },
    );
  }
  if (!secretMatches(request.headers.get("x-ghl-secret"), expected)) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Invalid or missing secret" } },
      { status: 401 },
    );
  }

  // 2. Rate limit. SECURITY GATE — runs before any business logic.
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { success: false, error: { code: "RATE_LIMITED", message: "Too many requests. Try again later." } },
      { status: 429 },
    );
  }

  // 3. Parse + validate.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid JSON" } },
      { status: 400 },
    );
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" } },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const normalizedEmail = data.email.toLowerCase().trim();

  // 4. Unified buyer intake. The service owns buyer find/create (Case 1/2/3),
  //    BuyerOpportunity + VehicleRequest creation, and the Group 3+4A pipeline
  //    (market enrichment, dealer discovery, phone scripts, lead scoring, and
  //    the 4-channel hot-lead notifications). We do NOT duplicate any of those.
  const year = parseYear(data.year);

  const input: UnifiedIntakeInput = {
    source: "phone_intake",

    firstName: data.firstName,
    lastName: data.lastName,
    email: normalizedEmail,
    phone: data.phone,
    zip: data.zip,

    make: data.make,
    model: data.model,
    trim: data.trim || undefined,
    vehicleType: mapVehicleType(data.newOrUsed),
    yearMin: year,
    yearMax: year,

    // Contract: budgetAmount is in CENTS.
    budgetAmount: parseGhlBudgetToCents(data.budget),
    timeline: normalizePhoneTimeline(data.timeline),

    hasTradeIn: data.hasTradeIn,
    financingNeeded: /yes|need|finance/i.test(data.financing),

    notes: buildNotes(data),
    utmSource: "ghl_phone_receptionist",
  };

  let vehicleRequestId: string | null = null;
  let buyerOpportunityId = "";
  try {
    const result = await intakeBuyerRequest(input);
    vehicleRequestId = result.vehicleRequestId;
    buyerOpportunityId = result.buyerOpportunityId;
  } catch (err) {
    // GHL retries on 5xx — but a thrown intake means the BuyerOpportunity may
    // not exist, so surface the failure so GHL retries the whole call.
    console.error("[phone-request] unified intake failed:", err);
    return NextResponse.json(
      { success: false, error: { code: "REQUEST_ERROR", message: "Could not save vehicle request" } },
      { status: 500 },
    );
  }

  // 5. Resolve the buyer the unified service stood up, for CRM identity
  //    linking and the QStash welcome sequence. When no VehicleRequest was
  //    created the buyer could not be resolved (Case A — partial payload);
  //    the BuyerOpportunity still persisted, so we return success to GHL but
  //    skip the buyer-scoped downstream steps.
  let buyerId = "";
  let buyerIsGuest = false;
  let buyerUserId = "";
  let buyerSupabaseId = "";
  if (vehicleRequestId) {
    const vr = await prisma.vehicleRequest.findUnique({
      where: { id: vehicleRequestId },
      select: {
        buyer: {
          select: {
            id: true,
            isGuest: true,
            user: { select: { id: true, supabaseId: true } },
          },
        },
      },
    });
    if (vr?.buyer) {
      buyerId = vr.buyer.id;
      buyerIsGuest = vr.buyer.isGuest ?? false;
      buyerUserId = vr.buyer.user?.id ?? "";
      buyerSupabaseId = vr.buyer.user?.supabaseId ?? "";
    }
  }

  if (!buyerId) {
    console.warn(
      "[phone-request] unified intake resolved no buyer — BuyerOpportunity " +
        "captured, skipping account upgrade, CRM sync and QStash dispatch",
      { buyerOpportunityId, email: normalizedEmail },
    );
    return NextResponse.json(
      {
        success: true,
        data: { vehicleRequestId, buyerOpportunityId, buyerId: null, accountCreated: false },
      },
      { status: 201 },
    );
  }

  // 6. Account upgrade — for net-new buyers only. The unified service creates a
  //    guest buyer (isGuest:true) whose User carries a `guest_` placeholder
  //    supabaseId (no real auth account yet). Provision a Supabase login,
  //    flip the buyer off guest, swap in the real supabaseId, and email the
  //    caller their temporary password. Returning buyers (real supabaseId, or
  //    already non-guest) are left untouched. Non-fatal: a provisioning failure
  //    must never lose the lead we already captured.
  let createdNewAccount = false;
  const needsProvisioning = buyerIsGuest && buyerSupabaseId.startsWith("guest_");
  if (needsProvisioning && buyerUserId) {
    const tempPassword = generateTempPassword();
    try {
      const supabase = adminSupabase();
      const { data: created, error: authErr } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { role: "BUYER", source: "phone-receptionist" },
      });
      if (authErr || !created?.user) {
        console.error("[phone-request] Supabase createUser failed:", authErr?.message);
      } else {
        await prisma.$transaction([
          prisma.user.update({
            where: { id: buyerUserId },
            data: { supabaseId: created.user.id, requiresPasswordChange: true },
          }),
          prisma.buyer.update({
            where: { id: buyerId },
            data: { isGuest: false },
          }),
        ]);
        createdNewAccount = true;

        // Welcome email with the temp password (idempotent on email).
        await sendAdminCreatedBuyerEmail(
          normalizedEmail,
          data.firstName,
          tempPassword,
          `${APP_URL}/auth/signin`,
        ).catch((err) => console.error("[phone-request] welcome email failed:", err));
      }
    } catch (provErr) {
      console.error("[phone-request] account provisioning failed:", provErr);
    }
  }

  // QStash — enter the buyer welcome + activation-recovery sequence so phone
  // receptionist leads get the same automation as web/landing-page buyers.
  dispatch({
    path: "/api/jobs/form-submitted",
    body: {
      buyerId,
      firstName: data.firstName,
      email: normalizedEmail,
      phone: data.phone,
      campaign: "phone-receptionist",
    },
  }).catch(() => {});

  // 7. CRM sync — must never block the intake response.
  try {
    const { getServiceSupabase } = await import("@/lib/supabase-service");
    const { ContactService } = await import("@/lib/services/contact.service");
    const supabase = getServiceSupabase();

    const contact = await ContactService.upsertContact(supabase, {
      email: normalizedEmail,
      phone: data.phone,
      firstName: data.firstName,
      lastName: data.lastName,
      source: "public_form",
      ipAddress: ip === "unknown" ? undefined : ip,
      consentEmail: true,
      consentSms: true, // collected over the phone with the caller
      consentText: "AutoLenis GHL AI phone receptionist — vehicle request",
    });

    await ContactService.linkContactIdentity(supabase, contact.id, "buyer", buyerId);

    if (contact.lifecycle_stage === "lead") {
      await ContactService.updateLifecycleStage(supabase, contact.id, "prequal_started", null);
    }

    await supabase.from("contact_timeline_events").insert({
      contact_id: contact.id,
      event_type: "note_added",
      event_data: {
        body: buildNotes(data),
        source: "phone-receptionist",
        vehicle_request_id: vehicleRequestId,
      },
      created_by: null,
    });
  } catch (crmErr) {
    console.error("[phone-request] CRM sync failed:", crmErr);
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        vehicleRequestId,
        buyerOpportunityId,
        buyerId,
        accountCreated: createdNewAccount,
      },
    },
    { status: 201 },
  );
}
