import { logger } from "@/lib/logger";
import { NextRequest, after } from "next/server";
import { z } from "zod";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { runPostIntakeOutreach } from "@/lib/services/acquisition/post-intake-outreach.service";
import { sendDealersContactedEmail } from "@/lib/services/email/buyer-notifications.service";
import {
  checkRateLimit,
  toBuyerLabel,
} from "@/lib/services/vehicle-request/vehicle-request.service";
import { createVehicleRequestFinancing } from "@/lib/services/vehicle-request/car-request-financing.service";
import {
  intakeBuyerRequest,
  type UnifiedIntakeInput,
} from "@/lib/services/acquisition/unified-buyer-intake.service";

// Map the financing wizard's purchaseTimeframe enum onto the unified intake
// service's free-form timeline strings (used for lead scoring).
function deriveTimeline(
  purchaseTimeframe: string | undefined,
): UnifiedIntakeInput["timeline"] {
  switch (purchaseTimeframe) {
    case "ASAP":
      return "asap";
    case "WITHIN_7_DAYS":
      return "this_week";
    case "WITHIN_30_DAYS":
      return "1_month";
    case "WITHIN_60_DAYS_PLUS":
      return "1_to_3_months";
    default:
      return "researching";
  }
}

// BuyerOpportunity.vehicleType is stored lowercase ("sedan", "suv", …) to match
// the public wizard / concierge convention, so normalize the dashboard's
// title-case body-type value before handing it to the intake service.
function mapVehicleType(t: string | undefined): string | undefined {
  if (!t) return undefined;
  return t.toLowerCase();
}

// BuyerOpportunity has no structured condition (new/used/either) column, so
// fold the buyer's choice into the free-form notes the team reads.
function combineNotes(
  notes: string | undefined,
  condition: string | undefined,
): string | undefined {
  if (!notes && !condition) return undefined;
  const parts: string[] = [];
  if (condition) parts.push(`Condition: ${condition}`);
  if (notes) parts.push(notes);
  return parts.join("\n");
}

// Top-level purchaseTimeframe (now a first-class dashboard field) maps onto the
// scoring timeline strings. Returns undefined when not supplied so the caller
// can fall back to the financing object's purchaseTimeframe.
function deriveTimelineFromPurchaseTimeframe(
  t: string | undefined,
): UnifiedIntakeInput["timeline"] | undefined {
  if (!t) return undefined;
  const map: Record<string, UnifiedIntakeInput["timeline"]> = {
    ASAP: "asap",
    WITHIN_7_DAYS: "this_week",
    WITHIN_30_DAYS: "1_month",
    WITHIN_60_DAYS_PLUS: "1_to_3_months",
  };
  return map[t];
}

// ─── Zod schema for optional financing object ─────────────────────────────────

const financingSchema = z.object({
  paymentMethod: z.enum(["FINANCE_AUTOLENIS", "FINANCE_OUTSIDE", "CASH", "LEASE", "UNDECIDED"]).optional(),
  preApprovalStatus: z.enum(["APPROVED", "WANTS_HELP", "SELF_ARRANGE", "CASH", "LEASE"]).optional(),
  // APPROVED branch
  lenderName: z.string().max(200).optional(),
  approvedAmountCents: z.number().int().nonnegative().optional(),
  quotedApr: z.number().nonnegative().max(100).optional(),
  approvalExpiresAt: z.string().datetime({ offset: true }).optional(),
  downPaymentCents: z.number().int().nonnegative().optional(),
  monthlyPaymentTargetCents: z.number().int().nonnegative().optional(),
  preApprovalLetterUrl: z.string().url().max(2000).optional(),
  // WANTS_HELP branch
  estimatedCreditRange: z.enum(["EXCELLENT", "GOOD", "FAIR", "BUILDING", "PREFER_NOT_TO_SAY"]).optional(),
  estimatedAnnualIncomeCents: z.number().int().nonnegative().optional(),
  // CASH branch
  proofOfFundsAvailable: z.boolean().optional(),
  maxBudgetCents: z.number().int().nonnegative().optional(),
  // LEASE branch
  leaseTermMonths: z.union([z.literal(24), z.literal(36), z.literal(48)]).optional(),
  leaseMilesPerYear: z.number().int().nonnegative().optional(),
  // Universal
  tradeIn: z.boolean().optional(),
  purchaseTimeframe: z.enum(["ASAP", "WITHIN_7_DAYS", "WITHIN_30_DAYS", "WITHIN_60_DAYS_PLUS"]).optional(),
  // leadQualityScore and adminBadge are NEVER accepted from client — computed server-side only
}).strict();

// GET /api/buyer/requests — list buyer requests
export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const requests = await prisma.vehicleRequest.findMany({
    where: { buyerId: buyer.id },
    include: { buyerUpdates: { orderBy: { createdAt: "desc" }, take: 1 }, offers: { where: { status: "SENT" } } },
    orderBy: { createdAt: "desc" },
  });

  const mapped = requests.map(r => ({
    ...r,
    statusLabel: toBuyerLabel(r.status),
    // Never expose internal admin notes or admin-only fields
    hasOffer: r.status === "OFFER_SENT" && r.offers.length > 0,
  }));

  return successResponse({ requests: mapped });
}

// POST /api/buyer/requests — submit new request
// Rate limit: 3/hour (VEHICLE_REQUEST_MAX_PER_HOUR)
// Prequal NOT required (V4 canonical: "prequal is encouraged but NOT gated at System 4C submission")
export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  // Rate limiting — 4th submission within 1 hour rejected with user-friendly error
  const withinLimit = await checkRateLimit(buyer.id);
  if (!withinLimit) {
    return errorResponse("RATE_LIMIT_EXCEEDED", "You may submit up to 3 requests per hour. Please wait before submitting another.", 429);
  }

  const body = await request.json() as {
    makePreference?: string;
    modelPreference?: string;
    yearMin?: number;
    yearMax?: number;
    vehicleType?: "SUV" | "Sedan" | "Truck" | "Van" | "Coupe" | "Other";
    condition?: "New" | "Used" | "Either";
    zip?: string;
    purchaseTimeframe?: "ASAP" | "WITHIN_7_DAYS" | "WITHIN_30_DAYS" | "WITHIN_60_DAYS_PLUS";
    maxBudgetCents?: number;
    notes?: string;
    financing?: unknown;
  };

  // Validate financing if present
  let validatedFinancing: z.infer<typeof financingSchema> | undefined;
  if (body.financing !== undefined && body.financing !== null) {
    const result = financingSchema.safeParse(body.financing);
    if (!result.success) {
      return errorResponse("VALIDATION_ERROR", result.error.errors[0]?.message ?? "Invalid financing data", 400);
    }
    validatedFinancing = result.data;
  }

  // Email lives on the related User, not the Buyer. The buyer is already
  // included with its user via getRequestBuyer, but query defensively so a
  // missing relation never throws here.
  const buyerWithUser = await prisma.buyer.findUnique({
    where: { id: buyer.id },
    include: { user: { select: { email: true } } },
  });
  const buyerEmail = buyerWithUser?.user?.email ?? undefined;

  // Route the submission through the unified intake service. Because the buyer
  // is already resolved by auth, the service skips all find/create logic and
  // creates the BuyerOpportunity + linked VehicleRequest, then fires the
  // Group 3 + 4A enrichment / dealer-discovery / scoring pipeline in the
  // background.
  const intakeInput: UnifiedIntakeInput = {
    source: "buyer_dashboard",
    buyerId: buyer.id,
    firstName: buyer.firstName ?? undefined,
    lastName: buyer.lastName ?? undefined,
    email: buyerEmail,
    phone: buyer.phone ?? undefined,
    // Editable ZIP from the form takes precedence over the buyer profile.
    zip: body.zip ?? buyer.zip ?? undefined,
    make: body.makePreference,
    model: body.modelPreference,
    yearMin: body.yearMin,
    yearMax: body.yearMax,
    vehicleType: mapVehicleType(body.vehicleType),
    budgetAmount: body.maxBudgetCents, // already in cents
    // Condition has no structured column on BuyerOpportunity, so fold it into notes.
    notes: combineNotes(body.notes, body.condition),
    // Prefer the new top-level purchaseTimeframe; fall back to the financing
    // object's purchaseTimeframe only when the form didn't supply one.
    timeline:
      deriveTimelineFromPurchaseTimeframe(body.purchaseTimeframe) ??
      deriveTimeline(validatedFinancing?.purchaseTimeframe),
    financingNeeded:
      validatedFinancing?.paymentMethod === "FINANCE_AUTOLENIS" ||
      validatedFinancing?.paymentMethod === "FINANCE_OUTSIDE",
    hasTradeIn: validatedFinancing?.tradeIn ?? false,
  };

  const { buyerOpportunityId, vehicleRequestId } =
    await intakeBuyerRequest(intakeInput);

  // ── Post-intake auto-outreach + buyer notification (non-blocking) ─────────
  // Contacts discovered dealers (privacy-safe) after the response is sent, then
  // emails the buyer the dealers-contacted count + $99 CTA. Never blocks intake.
  if (buyerOpportunityId) {
    after(async () => {
      try {
        const result = await runPostIntakeOutreach(buyerOpportunityId);

        if (result.dealersContacted > 0 && buyerEmail) {
          await sendDealersContactedEmail({
            buyerEmail,
            buyerFirstName: buyer.firstName ?? "there",
            vehicleMake: intakeInput.make ?? "",
            vehicleModel: intakeInput.model ?? "",
            dealerCount: result.dealersContacted,
            depositUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autolenis.com"}/buyer/deposit`,
          });
        }
      } catch (err) {
        logger.error("[post-intake] outreach or notification failed:", err);
      }
    });
  }

  // buyerId is always supplied here, so the service must have created a
  // VehicleRequest. If it didn't, surface a clear server error rather than
  // returning a malformed response.
  if (!vehicleRequestId) {
    return errorResponse(
      "INTAKE_FAILED",
      "We couldn't create your request. Please try again.",
      500,
    );
  }

  // Create financing record if provided (optional). The unified service does
  // not handle financing — preserve the dashboard's dedicated financing flow.
  if (validatedFinancing) {
    await createVehicleRequestFinancing(vehicleRequestId, validatedFinancing);
  }

  // The unified service creates the VehicleRequest but NOT the dashboard's
  // audit event / buyer-facing update (those were side effects of the old
  // createVehicleRequest helper). Recreate them here to preserve behavior.
  await prisma.vehicleRequestEvent.create({
    data: {
      requestId: vehicleRequestId,
      eventType: "SUBMITTED",
      actorId: buyer.id,
      actorRole: "BUYER",
      payload: JSON.parse(JSON.stringify(body)),
    },
  });

  await prisma.vehicleRequestBuyerUpdate.create({
    data: {
      requestId: vehicleRequestId,
      title: "Request received",
      body: "Our team has received your vehicle request and will begin researching options.",
    },
  });

  // Return request (financing is fetched separately to keep response shape consistent)
  const withFinancing = await prisma.vehicleRequest.findUnique({
    where: { id: vehicleRequestId },
    include: { financing: true },
  });

  return successResponse({ request: withFinancing }, 201);
}
