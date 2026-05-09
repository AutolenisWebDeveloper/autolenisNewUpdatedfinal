import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  submitRefinanceLead,
  EXCLUDED_STATES,
} from "@/lib/services/refinance/refinance-lead.service";

export const dynamic = "force-dynamic";

const CURRENT_YEAR = new Date().getFullYear();

const schema = z.object({
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  email: z.string().email().max(120),
  phone: z.string().min(7).max(30),
  vehicleYear: z.number().int().min(2010).max(CURRENT_YEAR),
  loanBalanceCents: z.number().int().min(0).max(500_000_00),
  monthlyPaymentCents: z.number().int().min(0).max(50_000_00),
  interestRateBand: z.enum(["UNDER_5", "5_TO_8", "8_TO_12", "OVER_12", "NOT_SURE"]),
  employmentStatus: z.enum(["FULL_TIME", "PART_TIME", "SELF_EMPLOYED", "RETIRED", "OTHER"]),
  state: z.string().length(2),
  consentGiven: z.literal(true),
  source: z.string().max(120).optional(),
});

export async function POST(request: NextRequest) {
  const correlationId = crypto.randomUUID();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body must be JSON" }, correlationId },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: parsed.error.message }, correlationId },
      { status: 400 },
    );
  }

  // Hard block at the API level for excluded states.
  if ((EXCLUDED_STATES as readonly string[]).includes(parsed.data.state.toUpperCase())) {
    return NextResponse.json(
      {
        error: {
          code: "EXCLUDED_STATE",
          message: "This program is not available in your state.",
        },
        correlationId,
      },
      { status: 422 },
    );
  }

  const ipAddress =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null;

  try {
    const result = await submitRefinanceLead({
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email,
      phone: parsed.data.phone,
      vehicleYear: parsed.data.vehicleYear,
      loanBalanceCents: parsed.data.loanBalanceCents,
      monthlyPaymentCents: parsed.data.monthlyPaymentCents,
      interestRateBand: parsed.data.interestRateBand,
      employmentStatus: parsed.data.employmentStatus,
      state: parsed.data.state,
      consentGiven: parsed.data.consentGiven,
      ipAddress,
      source: parsed.data.source,
    });

    return NextResponse.json(
      {
        success: true,
        data: { qualified: result.qualified, leadId: result.leadId },
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: { code: "SERVICE_ERROR", message: err instanceof Error ? err.message : "Unknown error" },
        correlationId,
      },
      { status: 500 },
    );
  }
}
