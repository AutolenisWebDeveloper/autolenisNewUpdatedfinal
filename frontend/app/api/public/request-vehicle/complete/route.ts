// POST /api/public/request-vehicle/complete
//
// Step 2 of the public buyer flow. After the landing-page form is submitted
// (handled by ../route.ts), the buyer lands on the thank-you page and fills in
<<<<<<< HEAD
// the "Complete Your Request" form with the remaining vehicle details.
//
// REBOUND IN PHASE 2 — THIS ROUTE NO LONGER RESOLVES A REQUEST BY EMAIL.
//
// It used to find "the buyer's most recent VehicleRequest by email" and write to
// it. §7.2 names that as one of three live rule-16 violations, and it is the worst
// of them: an unauthenticated caller who typed any registered buyer's address
// could rewrite that buyer's live request — make, model, year range and notes —
// with no session, no token and no verification. Rule 16 orders identity as
// authenticated buyer id → valid claim token → normalised VERIFIED email, and an
// address a caller merely asserts is none of those.
//
// It is now bound to a CAPABILITY the caller must hold:
//   • an authenticated buyer session, or
//   • the single-use resume/claim token minted for that specific request.
//
// The email is still accepted — the thank-you page has it, and the confirmation
// mail goes to it — but it identifies NOTHING. Without a session or a token the
// route answers 200 (the visitor filled the form in good faith) and records the
// detail against the CRM timeline, exactly as it already did for an unknown
// address; what it does not do is write to a request it cannot prove belongs to
// the caller.
=======
// the "Complete Your Request" form with the remaining vehicle details. This
// endpoint finds the buyer's most recent VehicleRequest by email, enriches it
// with the supplied detail, marks it as detail-complete (via a
// VehicleRequestEvent), and sends buyer + admin confirmation emails.
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
//
// All emails are best-effort and must never block the success response.
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
<<<<<<< HEAD
import { resolveIdentity } from "@/lib/services/acquisition/intake-identity";
import { findOpenRequest } from "@/lib/services/vehicle-request/open-request.service";
import { cancelDraftRecovery } from "@/lib/services/acquisition/draft-recovery.service";
import { consumeResumeToken } from "@/lib/services/buyer/request-resume-token.service";
import { getAuthenticatedBuyer } from "@/lib/auth/session";
=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
import {
  sendVehicleRequestCompletedConfirmation,
  sendVehicleRequestCompletedAdminNotification,
} from "@/lib/services/email/vehicle-offers.email";

export const dynamic = "force-dynamic";

const schema = z.object({
  email:            z.string().email(),
<<<<<<< HEAD
  /**
   * The single-use resume/claim token from the link the buyer was emailed. This
   * is what binds the submission to a request; the email does not.
   */
  claimToken:       z.string().min(8).max(200).optional(),
=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
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

<<<<<<< HEAD
/**
 * The authenticated buyer id from the session, or null.
 *
 * A public route may still be called by a signed-in buyer — the thank-you page is
 * reachable after registration — and when it is, tier 1 applies. Reading it from
 * the SESSION and never from the body is the whole point.
 */
async function authenticatedBuyerIdFrom(): Promise<string | null> {
  try {
    // Returns the Buyer row itself, and only for a Supabase-confirmed email —
    // which is exactly rule 16's tier 1.
    const buyer = await getAuthenticatedBuyer();
    return buyer?.id ?? null;
  } catch {
    // No session, or the cookie store is unavailable. Not an error here — it just
    // means tier 1 does not apply and the claim token is the only way in.
    return null;
  }
}

=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
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

<<<<<<< HEAD
    // ── Resolve identity in rule-16 order — NEVER by the asserted email ──────
    // Tier 1 is the session; tier 2 is the claim token. There is no tier-3 branch
    // here on purpose: a public caller's email is an assertion, and this route
    // WRITES to a live request.
    const identity = await resolveIdentity({
      authenticatedBuyerId: await authenticatedBuyerIdFrom(),
      claimToken: data.claimToken ?? null,
      // Passed for normalisation and logging only. `createIfMissing` is false, so
      // it can create nothing and — because tier 3 refuses a registered account to
      // an anonymous caller — it can attach to nothing either.
      email: data.email,
      createIfMissing: false,
    });

    const authorised = identity.tier === "AUTHENTICATED" || identity.tier === "CLAIM_TOKEN";
    const buyer = authorised && identity.buyerId
      ? await prisma.buyer.findUnique({
          where: { id: identity.buyerId },
          select: { id: true, firstName: true, lastName: true },
        })
      : null;

    // A claim token names the request it was minted for; a session does not, so an
    // authenticated buyer gets their ONE open request (§5 rule 5 guarantees there
    // is at most one).
    const vehicleRequest = !buyer
      ? null
      : identity.vehicleRequestId
        ? await prisma.vehicleRequest.findFirst({ where: { id: identity.vehicleRequestId, buyerId: buyer.id } })
        : await findOpenRequest(buyer.id);

    if (!authorised) {
      logger.info("[request-vehicle/complete] unauthenticated detail submission — recorded, not attached", {
        tier: identity.tier,
      });
    }

=======
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

>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
    const firstName = buyer?.firstName || "there";
    const fullName = buyer ? `${buyer.firstName} ${buyer.lastName}`.trim() : "";

    if (vehicleRequest) {
      // ── Update the canonical VehicleRequest with the supplied detail ───────
      const mergedNotes = [vehicleRequest.notes?.trim(), detailBlock]
        .filter(Boolean)
        .join("\n\n");

<<<<<<< HEAD
      // FORWARD ONLY, and only out of DRAFT — the same rule
      // `attachOrCreateOpenRequest` applies. Supplying the vehicle detail is what
      // the draft was waiting for, so a DRAFT becomes SUBMITTED here; every other
      // status is left exactly as it is, because a buyer filling in detail on a
      // live request must never rewind it.
      const promotedFromDraft = vehicleRequest.status === "DRAFT";

=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
      await prisma.vehicleRequest.update({
        where: { id: vehicleRequest.id },
        data: {
          ...(make ? { makePreference: make } : {}),
          ...(model ? { modelPreference: model } : {}),
          ...(data.yearFrom ? { yearMin: data.yearFrom } : {}),
          ...(data.yearTo ? { yearMax: data.yearTo } : {}),
<<<<<<< HEAD
          ...(promotedFromDraft ? { status: "SUBMITTED" as const } : {}),
=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
          notes: mergedNotes,
        },
      });

<<<<<<< HEAD
      // SINGLE USE. The token is emailed and can be forwarded; without this it
      // authorises the same write for its full 5-day TTL, which turns a deep-link
      // into a reusable write credential for someone else's request. It is
      // consumed AFTER the write it authorised, so a failed write leaves it usable.
      if (identity.tier === "CLAIM_TOKEN" && identity.claimTokenId) {
        await consumeResumeToken(identity.claimTokenId).catch((err) =>
          logger.error("[request-vehicle/complete] claim-token consume failed:", err),
        );
      }

      // §6.4's second half: the request advanced, so the four recovery touches
      // stop. Without this the buyer who just finished keeps being told to finish.
      //
      // A failure here is logged and does not fail the submission, because the
      // promotion above has already made the send-time recheck refuse these
      // templates (`skipIfRequestNoLongerDraft` reads the status, which is now
      // SUBMITTED). The cancel is what keeps the outbox honest about pending work;
      // the recheck is what keeps the wrong email from being sent. Losing the
      // first leaves four rows that will never send — losing the buyer's
      // successfully submitted detail because of it would be the worse trade.
      if (promotedFromDraft) {
        await cancelDraftRecovery(vehicleRequest.id, "draft completed by the buyer detail form").catch((err) =>
          logger.error("[request-vehicle/complete] draft-recovery cancel failed:", err),
        );
      }

=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
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
