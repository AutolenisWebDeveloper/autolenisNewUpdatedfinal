// POST /api/buyer/prequal — initiate FCRA-compliant soft pull via MicroBilt iPredict.
// GET  /api/buyer/prequal — return current buyer-safe prequal status.
//
// Required body fields: firstName, lastName, dateOfBirth (MM/DD/YYYY), address,
// city, state, zip, fcraConsent (must be true), monthlyIncome (number, dollars).
// Optional: employmentStatus, employerName, lengthOfEmployment.
// Employment fields are AutoLenis-internal only and are NEVER forwarded to MicroBilt.

import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { initiatePrsequal, toBuyerSafePrequal } from "@/lib/services/prequal/prequal.service";

export const dynamic = "force-dynamic";

const STATE_RE = /^[A-Z]{2}$/i;
const ZIP_RE = /^\d{5}$/;
const DOB_RE = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/;

const submissionSchema = z.object({
  firstName: z.string().trim().min(1).max(64),
  lastName: z.string().trim().min(1).max(64),
  dateOfBirth: z.string().regex(DOB_RE, "Date of birth must be MM/DD/YYYY"),
  address: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(100),
  state: z.string().regex(STATE_RE, "State must be a 2-letter code"),
  zip: z.string().regex(ZIP_RE, "ZIP must be 5 digits"),
  fcraConsent: z.literal(true, {
    errorMap: () => ({ message: "FCRA consent is required" }),
  }),

  // Optional employment — never sent to MicroBilt
  employmentStatus: z.string().trim().max(64).optional(),
  employerName: z.string().trim().max(120).optional(),
  monthlyIncome: z.number()
    .max(1_000_000, "Please enter your monthly gross income (not annual)")
    .refine(v => v >= 500, "Monthly income must be at least $500"),
  lengthOfEmployment: z.string().trim().max(64).optional(),

  // Housing + debt obligations (Section 2.5) — never sent to MicroBilt.
  housingStatus: z.enum(["RENT", "MORTGAGE", "OWN", "FAMILY"]).optional(),
  monthlyHousingPayment: z.number().min(0).max(20_000).optional(),
  monthlyOtherDebt: z.number().min(0).max(30_000).default(0),
}).superRefine((data, ctx) => {
  // Housing payment is required when the buyer rents or has a mortgage.
  if (
    (data.housingStatus === "RENT" || data.housingStatus === "MORTGAGE") &&
    (data.monthlyHousingPayment === undefined || data.monthlyHousingPayment === null)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["monthlyHousingPayment"],
      message: "Monthly housing payment is required for renters and mortgage holders",
    });
  }
});

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON payload", 400);
  }

  const parsed = submissionSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const code = first?.path?.[0] === "fcraConsent" ? "FCRA_CONSENT_REQUIRED" : "VALIDATION_ERROR";
    return errorResponse(code, first?.message ?? "Invalid input", 400);
  }
  const d = parsed.data;

  // Capture audit metadata for the FCRA consent record
  const ipAddress =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    undefined;
  const userAgent = request.headers.get("user-agent") ?? undefined;

  try {
    const result = await initiatePrsequal(
      {
        id: buyer.id,
        // Existing buyer-stated budget acts as fallback for maxOtdAmountCents.
        // The buyer-facing API never accepts this field — it stays immutable
        // server-side after iPredict has been called.
        maxOtdAmountCents: buyer.preQualification?.maxOtdAmountCents ?? null,
        user: { email: buyer.user.email },
      },
      {
        firstName: d.firstName,
        lastName: d.lastName,
        dateOfBirth: d.dateOfBirth,
        address: d.address,
        city: d.city,
        state: d.state,
        zip: d.zip,
        fcraConsent: d.fcraConsent,
        employmentStatus: d.employmentStatus,
        employerName: d.employerName,
        monthlyIncomeCents:
          typeof d.monthlyIncome === "number"
            ? Math.round(d.monthlyIncome * 100)
            : undefined,
        lengthOfEmployment: d.lengthOfEmployment,
        housingStatus: d.housingStatus,
        monthlyHousingPaymentCents:
          typeof d.monthlyHousingPayment === "number"
            ? Math.round(d.monthlyHousingPayment * 100)
            : undefined,
        monthlyOtherDebtCents:
          typeof d.monthlyOtherDebt === "number"
            ? Math.round(d.monthlyOtherDebt * 100)
            : undefined,
        ipAddress,
        userAgent,
      },
    );

    // Never expose raw iPredict data
    const safe = toBuyerSafePrequal(result.prequal);
    return successResponse({ ...safe, mocked: result.mocked });
  } catch (err) {
    console.error("[prequal] initiatePrsequal failed:", err);
    return errorResponse(
      "PREQUAL_FAILED",
      "Unable to process prequalification. Please try again.",
      502,
    );
  }
}

export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  if (!buyer.preQualification) return successResponse({ hasPrequal: false });

  const pq = toBuyerSafePrequal(buyer.preQualification);
  return successResponse({ hasPrequal: true, ...pq });
}
