// POST /api/admin/buyers/[buyerId]/prequal/run-ipredict
// Admin-initiated real MicroBilt iPredict prequalification.
//
// Requires:
//   - Admin authentication (MFA-verified)
//   - All iPredict required PII fields in the request body
//   - consentSource: one of 6 allowed values
//   - consentTimestamp: when the buyer gave authorization (ISO datetime)
//   - authorizationSummary: admin's description of how the buyer authorized
//   - adminCertification: must be true (admin certifies buyer authorization)
//   - reason note (stored in AdminAuditLog)
//
// Delegates to runAdminIPredictPrequalForBuyer() which:
//   - For EXISTING_PREQUAL_CONSENT: verifies a PrequalConsent DB record exists
//   - For external sources: creates a clearly-marked admin-recorded consent row
//   - Calls the real MicroBilt iPredict service
//   - Enforces OFAC hard gate
//   - Upserts PreQualification + PrequalConsent record
//   - Writes AdminAuditLog + ComplianceEvent
//   - Sends approval / adverse-action emails where required

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getAdminWithRole, adminSuccess, adminError } from "@/lib/auth/admin-api";
import {
  runAdminIPredictPrequalForBuyer,
  type ConsentSource,
} from "@/lib/services/prequal/admin-prequal.service";

interface Props { params: Promise<{ buyerId: string }> }

const DOB_RE = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/;
const STATE_RE = /^[A-Za-z]{2}$/;
const ZIP_RE = /^\d{5}$/;

const CONSENT_SOURCES = [
  "EXISTING_PREQUAL_CONSENT",
  "PHONE_VERBAL_AUTHORIZATION",
  "EMAIL_AUTHORIZATION",
  "TEXT_AUTHORIZATION",
  "SIGNED_DOCUMENT_AUTHORIZATION",
  "IN_PERSON_AUTHORIZATION",
] as const;

const schema = z.object({
  // Required iPredict PII fields
  firstName:    z.string().trim().min(1).max(64),
  lastName:     z.string().trim().min(1).max(64),
  dateOfBirth:  z.string().regex(DOB_RE, "Date of birth must be MM/DD/YYYY"),
  address:      z.string().trim().min(1).max(200),
  city:         z.string().trim().min(1).max(100),
  state:        z.string().regex(STATE_RE, "State must be a 2-letter code"),
  zip:          z.string().regex(ZIP_RE, "ZIP must be 5 digits"),

  // Optional internal fields — stored on PreQualification, never sent to MicroBilt
  employmentStatus:   z.string().trim().max(64).optional(),
  employerName:       z.string().trim().max(120).optional(),
  /** Monthly income in dollars — stored internally as cents. */
  monthlyIncomeUsd:   z.number().nonnegative().max(1_000_000).optional(),
  lengthOfEmployment: z.string().trim().max(64).optional(),

  // Housing + debt obligations — stored internally, never sent to MicroBilt.
  housingStatus:         z.enum(["RENT", "MORTGAGE", "OWN", "FAMILY"]).optional(),
  monthlyHousingPayment: z.number().min(0).max(20_000).optional(),
  monthlyOtherDebt:      z.number().min(0).max(30_000).default(0),

  // Required admin consent / authorization acknowledgment fields
  consentSource: z.enum(CONSENT_SOURCES, {
    errorMap: () => ({ message: "Invalid consent source" }),
  }),
  /** ISO-8601 datetime of when the buyer gave authorization. */
  consentTimestamp: z.string().datetime({ message: "Consent timestamp must be a valid ISO-8601 datetime" }),
  /** Admin's description of how the buyer authorized — stored as consent record. */
  authorizationSummary: z.string().trim().min(1, "Authorization summary is required").max(2000),
  /** Optional reference — email subject, call note, doc name, etc. */
  authorizationReference: z.string().trim().max(500).optional(),
  /** Admin must certify buyer authorized this run. */
  adminCertification: z.literal(true, {
    errorMap: () => ({ message: "Admin certification is required" }),
  }),

  // Required admin workflow note
  reason: z.string().trim().min(1, "Reason note is required").max(1000),
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

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN", "COMPLIANCE_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return adminError(
      "VALIDATION_ERROR",
      first?.message ?? "Invalid input",
      400
    );
  }

  const d = parsed.data;

  try {
    const result = await runAdminIPredictPrequalForBuyer({
      buyerId,
      adminId: admin.adminId,
      adminEmail: admin.email,
      input: {
        firstName: d.firstName,
        lastName: d.lastName,
        dateOfBirth: d.dateOfBirth,
        address: d.address,
        city: d.city,
        state: d.state,
        zip: d.zip,
        employmentStatus: d.employmentStatus,
        employerName: d.employerName,
        monthlyIncomeCents:
          typeof d.monthlyIncomeUsd === "number"
            ? Math.round(d.monthlyIncomeUsd * 100)
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
      },
      reason: d.reason,
      consentSource: d.consentSource as ConsentSource,
      consentTimestamp: d.consentTimestamp,
      authorizationSummary: d.authorizationSummary,
      authorizationReference: d.authorizationReference,
      adminCertification: true,
    });

    return adminSuccess(result, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg === "Buyer not found") return adminError("NOT_FOUND", "Buyer not found", 404);
    logger.error("[admin/prequal/run-ipredict]", err);
    return adminError("SERVER_ERROR", "Failed to run iPredict", 500);
  }
}
