import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  markLeadRedirected,
  buildPartnerRedirectUrl,
} from "@/lib/services/refinance/refinance-lead.service";

export const dynamic = "force-dynamic";

const schema = z.object({
  leadId: z.string().min(1).max(60),
});

// GET /api/public/refinance/redirect?leadId=... — fetch current status
export async function GET(request: NextRequest) {
  const leadId = request.nextUrl.searchParams.get("leadId") ?? "";
  if (!leadId) {
    return NextResponse.json(
      { error: { code: "MISSING_LEAD_ID", message: "leadId is required" } },
      { status: 400 },
    );
  }
  const lead = await prisma.refinanceApplication.findUnique({
    where: { leadId },
    select: { leadId: true, status: true, vehicleYear: true, loanBalanceCents: true, state: true },
  });
  if (!lead) {
    return NextResponse.json(
      { error: { code: "LEAD_NOT_FOUND", message: "Lead does not exist" } },
      { status: 404 },
    );
  }
  return NextResponse.json({
    success: true,
    data: {
      leadId: lead.leadId,
      status: lead.status,
      vehicleYear: lead.vehicleYear,
      loanBalance: (Number(lead.loanBalanceCents) / 100).toFixed(2),
      state: lead.state,
    },
  });
}

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

  const lead = await markLeadRedirected(parsed.data.leadId);
  if (!lead) {
    return NextResponse.json(
      { error: { code: "LEAD_NOT_FOUND", message: "Lead does not exist" }, correlationId },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        leadId: lead.leadId,
        status: lead.status,
        redirectUrl: buildPartnerRedirectUrl(lead.leadId),
      },
    },
    { status: 200 },
  );
}
