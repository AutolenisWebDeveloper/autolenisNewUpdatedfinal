// POST /api/public/request-vehicle/complete
//
// Step 2 of the public buyer flow. After the landing-page form is submitted
// (handled by ../route.ts), the buyer lands on the thank-you page and fills in
// the "Complete Your Request" form with the remaining vehicle details. This
// endpoint finds the buyer's most recent VehicleRequest by email, enriches it
// with the supplied detail, marks it as detail-complete (via a
// VehicleRequestEvent), and sends buyer + admin confirmation emails.
//
// All emails are best-effort and must never block the success response.
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  sendVehicleRequestCompletedConfirmation,
  sendVehicleRequestCompletedAdminNotification,
} from "@/lib/services/email/vehicle-offers.email";

export const dynamic = "force-dynamic";

const schema = z.object({
  email:            z.string().email(),
  make:             z.string().max(50).optional(),
  model:            z.string().max(80).optional(),
  yearFrom:         z.coerce.number().int().min(1990).max(2030).optional(),
  yearTo:           z.coerce.number().int().min(1990).max(2030).optional(),
  mileagePreference: z.string().max(40).optional(),
  color:            z.string().max(50).optional(),
  features:         z.string().max(1000).optional(),
  financingPlan:    z.string().max(80).optional(),
  downPayment:      z.string().max(40).optional(),
  hasTradeIn:       z.boolean().optional(),
  tradeInYear:      z.string().max(10).optional(),
  tradeInMake:      z.string().max(50).optional(),
  tradeInModel:     z.string().max(80).optional(),
  tradeInMileage:   z.string().max(40).optional(),
  tradeInCondition: z.string().max(20).optional(),
  additionalNotes:  z.string().max(1000).optional(),
});

type Parsed = z.infer<typeof schema>;

// Values the frontend uses to mean "no preference" — treated as unset.
const ANY_VALUES = new Set(["", "any", "any make", "any mileage", "not sure", "not sure yet"]);
function meaningful(v?: string): string | undefined {
  if (!v) return undefined;
  const trimmed = v.trim();
  return ANY_VALUES.has(trimmed.toLowerCase()) ? undefined : trimmed;
}

export async function POST(request: NextRequest) {
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
  const data: Parsed = parsed.data;

  try {
    const make = meaningful(data.make);
    const model = meaningful(data.model);
    const color = meaningful(data.color);
    const features = meaningful(data.features);
    const mileagePreference = meaningful(data.mileagePreference);
    const financingPlan = meaningful(data.financingPlan);
    const downPayment = meaningful(data.downPayment);

    // ── Build a human-readable summary (used in notes + both emails) ─────────
    const summaryRows: [string, string][] = [];
    if (make) summaryRows.push(["Preferred Make", make]);
    if (model) summaryRows.push(["Preferred Model", model]);
    if (data.yearFrom || data.yearTo) {
      summaryRows.push(["Year Range", `${data.yearFrom ?? "Any"} – ${data.yearTo ?? "Any"}`]);
    }
    if (mileagePreference) summaryRows.push(["Mileage Preference", mileagePreference]);
    if (color) summaryRows.push(["Preferred Color", color]);
    if (features) summaryRows.push(["Special Features", features]);
    if (financingPlan) summaryRows.push(["Financing Plan", financingPlan]);
    if (downPayment) summaryRows.push(["Down Payment", downPayment]);
    if (typeof data.hasTradeIn === "boolean") {
      const trade = data.hasTradeIn
        ? [data.tradeInYear, data.tradeInMake, data.tradeInModel].filter(Boolean).join(" ") || "Yes"
        : "No";
      summaryRows.push(["Trade-In", trade]);
      if (data.hasTradeIn && meaningful(data.tradeInMileage)) {
        summaryRows.push(["Trade-In Mileage", data.tradeInMileage!.trim()]);
      }
      if (data.hasTradeIn && meaningful(data.tradeInCondition)) {
        summaryRows.push(["Trade-In Condition", data.tradeInCondition!.trim()]);
      }
    }
    if (meaningful(data.additionalNotes)) {
      summaryRows.push(["Additional Notes", data.additionalNotes!.trim()]);
    }

    const detailBlock =
      "── Buyer-completed details ──\n" +
      (summaryRows.length
        ? summaryRows.map(([k, v]) => `${k}: ${v}`).join("\n")
        : "No additional details provided.");

    const detailPayload = {
      make: make ?? null,
      model: model ?? null,
      yearFrom: data.yearFrom ?? null,
      yearTo: data.yearTo ?? null,
      mileagePreference: mileagePreference ?? null,
      color: color ?? null,
      features: features ?? null,
      financingPlan: financingPlan ?? null,
      downPayment: downPayment ?? null,
      hasTradeIn: data.hasTradeIn ?? null,
      tradeInYear: data.tradeInYear ?? null,
      tradeInMake: data.tradeInMake ?? null,
      tradeInModel: data.tradeInModel ?? null,
      tradeInMileage: data.tradeInMileage ?? null,
      tradeInCondition: data.tradeInCondition ?? null,
      additionalNotes: data.additionalNotes ?? null,
    };

    // ── Resolve the buyer + most recent VehicleRequest by email ──────────────
    // A missing buyer/request must NOT fail the caller: they filled the form in
    // good faith. We persist what we can (CRM contact timeline) and still 200.
    const user = await prisma.user.findUnique({
      where:   { email: data.email.toLowerCase() },
      include: { buyer: { select: { id: true, firstName: true, lastName: true } } },
    });
    const buyer = user?.buyer ?? null;

    const vehicleRequest = buyer
      ? await prisma.vehicleRequest.findFirst({
          where:   { buyerId: buyer.id },
          orderBy: { createdAt: "desc" },
        })
      : null;

    const firstName = buyer?.firstName || "there";
    const fullName = buyer ? `${buyer.firstName} ${buyer.lastName}`.trim() : "";

    if (vehicleRequest) {
      // ── Update the canonical VehicleRequest with the supplied detail ───────
      const mergedNotes = [vehicleRequest.notes?.trim(), detailBlock]
        .filter(Boolean)
        .join("\n\n");

      await prisma.vehicleRequest.update({
        where: { id: vehicleRequest.id },
        data: {
          ...(make ? { makePreference: make } : {}),
          ...(model ? { modelPreference: model } : {}),
          ...(data.yearFrom ? { yearMin: data.yearFrom } : {}),
          ...(data.yearTo ? { yearMax: data.yearTo } : {}),
          notes: mergedNotes,
        },
      });

      // ── Mark the request as detail-complete (event-sourced flag) ───────────
      await prisma.vehicleRequestEvent.create({
        data: {
          requestId: vehicleRequest.id,
          eventType: "buyer_detail_completed",
          actorRole: "buyer",
          note: "Buyer completed the step 2 vehicle-detail form.",
          payload: detailPayload,
        },
      }).catch((err) => logger.error("[request-vehicle/complete] event create failed:", err));
    } else {
      // ── Fallback: no buyer account / no request on file ────────────────────
      // Persist the completion detail to the CRM contact timeline if a contact
      // exists, so the buyer's effort is never lost. Best-effort: a CRM failure
      // must not turn a successful form submission into an error for the caller.
      try {
        const { getServiceSupabase } = await import("@/lib/supabase-service");
        const { ContactService } = await import("@/lib/services/contact.service");
        const supabase = getServiceSupabase();
        const { data: contact } = await ContactService.findContactByEmail(supabase, data.email);
        if (contact) {
          await supabase.from("contact_timeline_events").insert({
            contact_id: contact.id,
            event_type: "note_added",
            event_data: {
              body: `Vehicle request step 2 completed (no buyer account on file).\n${detailBlock}`,
              source: "ty_step2_complete",
              detail: detailPayload,
            },
            created_by: null,
          });
        }
      } catch (crmErr) {
        logger.error("[request-vehicle/complete] CRM fallback save failed:", crmErr);
      }
    }

    // ── Best-effort notifications ────────────────────────────────────────────
    const vehicleLine =
      [data.yearFrom ?? data.yearTo, make ?? "Any make", model ?? ""].filter(Boolean).join(" ").trim() ||
      "vehicle details";
    const budgetLine =
      vehicleRequest?.maxBudgetCents != null
        ? `$${(vehicleRequest.maxBudgetCents / 100).toLocaleString()}`
        : "not specified";
    const summaryLine = vehicleRequest
      ? `Vehicle request completed by ${fullName}: ${vehicleLine}, budget ${budgetLine}`
      : `Vehicle request completed by ${data.email} (no buyer account on file): ${vehicleLine}`;

    await Promise.allSettled([
      sendVehicleRequestCompletedConfirmation(data.email, firstName, summaryRows),
      sendVehicleRequestCompletedAdminNotification({
        fullName: fullName || data.email,
        email: data.email,
        summaryLine,
        summaryRows,
        vehicleRequestId: vehicleRequest?.id,
      }),
    ]);

    if (!vehicleRequest) {
      return NextResponse.json({
        success: true,
        accountFound: false,
        note: "Account not found — your details were saved and our team will follow up.",
      });
    }
    return NextResponse.json({ success: true, accountFound: true });
  } catch (err) {
    logger.error("[request-vehicle/complete] failed:", err);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to complete request" } },
      { status: 500 },
    );
  }
}
