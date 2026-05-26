// POST /api/public/phone-request
//
// Server-to-server intake for vehicle requests collected by the GoHighLevel
// AI phone receptionist. GHL POSTs the structured call result here; the route
// resolves (or provisions) a buyer account, persists a VehicleRequest, and
// syncs the lead into the CRM.
//
// Auth is a shared secret in the `X-GHL-Secret` header — this endpoint is not
// browser-facing, so there is no cookie/session involved.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { UserRole } from "@prisma/client";
import { sendAdminCreatedBuyerEmail } from "@/lib/services/email/resend.service";
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

// Pull the largest dollar figure out of a free-form budget string
// ("$30,000", "$25,000–$35,000", "30000") and convert to integer cents.
function parseBudgetToCents(budget: string): number | null {
  const matches = budget.match(/\d[\d,]*/g);
  if (!matches) return null;
  const values = matches
    .map((m) => parseInt(m.replace(/,/g, ""), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (values.length === 0) return null;
  return Math.max(...values) * 100;
}

function parseYear(year: string): number | null {
  const n = parseInt(year, 10);
  return Number.isFinite(n) && n >= 1980 && n <= 2030 ? n : null;
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

export async function POST(request: NextRequest) {
  // 1. Shared-secret auth.
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

  // 2. Rate limit.
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

  // 4. Resolve or provision the buyer. VehicleRequest.buyerId is NOT NULL.
  let buyerId = "";
  let createdNewAccount = false;
  let tempPassword = "";
  let provisionedSupabaseId: string | null = null;

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { buyer: { select: { id: true } } },
    });

    if (existingUser?.buyer) {
      // Existing buyer — reuse.
      buyerId = existingUser.buyer.id;
    } else if (existingUser && !existingUser.buyer) {
      // User exists without a buyer profile — attach one.
      const buyer = await prisma.buyer.create({
        data: {
          userId: existingUser.id,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          zip: data.zip,
        },
      });
      buyerId = buyer.id;
    } else {
      // No account — provision a full buyer account with a temp password.
      tempPassword = generateTempPassword();
      const supabase = adminSupabase();
      const { data: created, error: authErr } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { role: "BUYER", source: "phone-receptionist" },
      });
      if (authErr || !created?.user) {
        console.error("[phone-request] Supabase createUser failed:", authErr?.message);
        return NextResponse.json(
          { success: false, error: { code: "SIGNUP_FAILED", message: "Could not create buyer account" } },
          { status: 500 },
        );
      }
      provisionedSupabaseId = created.user.id;

      try {
        const buyer = await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              supabaseId: provisionedSupabaseId!,
              email: normalizedEmail,
              role: UserRole.BUYER,
              requiresPasswordChange: true,
            },
          });
          return tx.buyer.create({
            data: {
              userId: user.id,
              firstName: data.firstName,
              lastName: data.lastName,
              phone: data.phone,
              zip: data.zip,
            },
          });
        });
        buyerId = buyer.id;
        createdNewAccount = true;
      } catch (dbErr) {
        // Roll back the orphaned Supabase user.
        await supabase.auth.admin.deleteUser(provisionedSupabaseId).catch(() => {});
        throw dbErr;
      }
    }
  } catch (err) {
    console.error("[phone-request] buyer resolve/create failed:", err);
    return NextResponse.json(
      { success: false, error: { code: "BUYER_ERROR", message: "Could not resolve buyer" } },
      { status: 500 },
    );
  }

  // 5. Create the VehicleRequest.
  const year = parseYear(data.year);
  let vehicleRequestId: string;
  try {
    const vehicleRequest = await prisma.vehicleRequest.create({
      data: {
        buyerId,
        status: "SUBMITTED",
        makePreference: data.make,
        modelPreference: data.model,
        yearMin: year,
        yearMax: year,
        maxBudgetCents: parseBudgetToCents(data.budget),
        notes: buildNotes(data),
        utmSource: data.source,
        ipAddress: ip === "unknown" ? null : ip,
      },
    });
    vehicleRequestId = vehicleRequest.id;
  } catch (err) {
    console.error("[phone-request] VehicleRequest create failed:", err);
    return NextResponse.json(
      { success: false, error: { code: "REQUEST_ERROR", message: "Could not save vehicle request" } },
      { status: 500 },
    );
  }

  // 6. Welcome email for newly provisioned accounts (non-fatal).
  if (createdNewAccount && tempPassword) {
    await sendAdminCreatedBuyerEmail(
      normalizedEmail,
      data.firstName,
      tempPassword,
      `${APP_URL}/auth/signin`,
    ).catch((err) => console.error("[phone-request] welcome email failed:", err));
  }

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
        buyerId,
        accountCreated: createdNewAccount,
      },
    },
    { status: 201 },
  );
}
