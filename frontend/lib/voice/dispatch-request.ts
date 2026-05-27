// Persist a vehicle request collected by Zura over the phone, then kick off the
// same post-intake flow the web form uses.
//
// Mirrors the GHL intake at /api/public/phone-request: resolve or provision a
// buyer (VehicleRequest.buyerId is NOT NULL), create the VehicleRequest, sync
// the lead into the CRM, and dispatch the form-submitted job. Voice collects
// fewer fields than the web form, so everything beyond name/email is optional.

import { prisma } from "@/lib/prisma";
import { UserRole } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { dispatch } from "@/lib/qstash/dispatch";
import type { VehicleRequestDraft } from "@/lib/voice/conversation-store";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

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

// Pull the largest dollar figure out of a free-form budget phrase
// ("thirty thousand", "$25,000", "25k") and return integer cents, or null.
function parseBudgetToCents(budget: string | undefined): number | null {
  if (!budget) return null;
  const matches = budget.match(/\d[\d,]*/g);
  if (!matches) return null;
  const values = matches
    .map((m) => parseInt(m.replace(/,/g, ""), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (values.length === 0) return null;
  return Math.max(...values) * 100;
}

function buildNotes(req: VehicleRequestDraft, callerPhone: string): string {
  const lines = [
    "Inbound phone request via Zura voice receptionist.",
    req.newOrUsed ? `Condition: ${req.newOrUsed}.` : "",
    req.make || req.model
      ? `Vehicle: ${[req.make, req.model].filter(Boolean).join(" ")}.`
      : "",
    req.budget ? `Budget: ${req.budget}.` : "",
    req.timeline ? `Timeline: ${req.timeline}.` : "",
    callerPhone ? `Caller: ${callerPhone}.` : "",
  ].filter(Boolean);
  return lines.join(" ");
}

export interface DispatchResult {
  success: boolean;
  buyerId?: string;
  vehicleRequestId?: string;
  error?: string;
}

export async function dispatchVehicleRequest(
  req: VehicleRequestDraft,
  callerPhone: string,
): Promise<DispatchResult> {
  const firstName = req.firstName?.trim();
  const lastName = req.lastName?.trim();
  const email = req.email?.trim().toLowerCase();

  if (!firstName || !lastName || !email) {
    return { success: false, error: "missing required identity fields" };
  }

  // 1. Resolve or provision the buyer.
  let buyerId = "";
  let createdNewAccount = false;
  let tempPassword = "";

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email },
      include: { buyer: { select: { id: true } } },
    });

    if (existingUser?.buyer) {
      buyerId = existingUser.buyer.id;
    } else if (existingUser && !existingUser.buyer) {
      const buyer = await prisma.buyer.create({
        data: { userId: existingUser.id, firstName, lastName, phone: callerPhone || null },
      });
      buyerId = buyer.id;
    } else {
      tempPassword = generateTempPassword();
      const supabase = adminSupabase();
      const { data: created, error: authErr } = await supabase.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { role: "BUYER", source: "voice-receptionist" },
      });
      if (authErr || !created?.user) {
        console.error("[voice/dispatch] Supabase createUser failed:", authErr?.message);
        return { success: false, error: "could not create buyer account" };
      }
      const supabaseId = created.user.id;
      try {
        const buyer = await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: { supabaseId, email, role: UserRole.BUYER, requiresPasswordChange: true },
          });
          return tx.buyer.create({
            data: { userId: user.id, firstName, lastName, phone: callerPhone || null },
          });
        });
        buyerId = buyer.id;
        createdNewAccount = true;
      } catch (dbErr) {
        await supabase.auth.admin.deleteUser(supabaseId).catch(() => {});
        throw dbErr;
      }
    }
  } catch (err) {
    console.error("[voice/dispatch] buyer resolve/create failed:", err);
    return { success: false, error: "could not resolve buyer" };
  }

  // 2. Create the VehicleRequest.
  let vehicleRequestId: string;
  try {
    const vehicleRequest = await prisma.vehicleRequest.create({
      data: {
        buyerId,
        status: "SUBMITTED",
        makePreference: req.make ?? null,
        modelPreference: req.model ?? null,
        maxBudgetCents: parseBudgetToCents(req.budget),
        notes: buildNotes(req, callerPhone),
        utmSource: "voice-receptionist",
      },
    });
    vehicleRequestId = vehicleRequest.id;
  } catch (err) {
    console.error("[voice/dispatch] VehicleRequest create failed:", err);
    return { success: false, buyerId, error: "could not save vehicle request" };
  }

  // 3. Welcome email for newly provisioned accounts (non-fatal).
  if (createdNewAccount && tempPassword) {
    try {
      const { sendAdminCreatedBuyerEmail } = await import("@/lib/services/email/resend.service");
      await sendAdminCreatedBuyerEmail(email, firstName, tempPassword, `${APP_URL}/auth/signin`);
    } catch (err) {
      console.error("[voice/dispatch] welcome email failed:", err);
    }
  }

  // 4. CRM sync — never block on it.
  try {
    const { getServiceSupabase } = await import("@/lib/supabase-service");
    const { ContactService } = await import("@/lib/services/contact.service");
    const supabase = getServiceSupabase();

    const contact = await ContactService.upsertContact(supabase, {
      email,
      phone: callerPhone || undefined,
      firstName,
      lastName,
      source: "public_form",
      consentEmail: true,
      consentSms: true, // collected over the phone with the caller
      consentText: "AutoLenis Zura voice receptionist — vehicle request",
    });

    await ContactService.linkContactIdentity(supabase, contact.id, "buyer", buyerId);

    if (contact.lifecycle_stage === "lead") {
      await ContactService.updateLifecycleStage(supabase, contact.id, "prequal_started", null);
    }

    await supabase.from("contact_timeline_events").insert({
      contact_id: contact.id,
      event_type: "note_added",
      event_data: {
        body: buildNotes(req, callerPhone),
        source: "voice-receptionist",
        vehicle_request_id: vehicleRequestId,
      },
      created_by: null,
    });
  } catch (crmErr) {
    console.error("[voice/dispatch] CRM sync failed:", crmErr);
  }

  // 5. Fire the standard post-intake flow (welcome SMS/email + abandonment timer).
  await dispatch({
    path: "/api/jobs/form-submitted",
    body: { buyerId, firstName, email, phone: callerPhone || null },
  });

  return { success: true, buyerId, vehicleRequestId };
}
