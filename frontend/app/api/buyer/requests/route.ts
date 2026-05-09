import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import {
  checkRateLimit,
  hasActiveRequest,
  createVehicleRequest,
  toBuyerLabel,
} from "@/lib/services/vehicle-request/vehicle-request.service";
import { createVehicleRequestFinancing } from "@/lib/services/vehicle-request/car-request-financing.service";

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

  const vehicleRequest = await createVehicleRequest(buyer.id, {
    makePreference: body.makePreference,
    modelPreference: body.modelPreference,
    yearMin: body.yearMin,
    yearMax: body.yearMax,
    maxBudgetCents: body.maxBudgetCents,
    notes: body.notes,
  });

  // Create financing record if provided (optional)
  if (validatedFinancing) {
    await createVehicleRequestFinancing(vehicleRequest.id, validatedFinancing);
  }

  // Return request (financing is fetched separately to keep response shape consistent)
  const withFinancing = await prisma.vehicleRequest.findUnique({
    where: { id: vehicleRequest.id },
    include: { financing: true },
  });

  return successResponse({ request: withFinancing }, 201);
}
