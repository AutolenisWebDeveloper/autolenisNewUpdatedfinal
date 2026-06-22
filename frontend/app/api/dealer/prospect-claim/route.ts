// F-010 — recruited-prospect one-click claim.
//   GET  ?token=...   → prefill data for the claim form (no mutation)
//   POST { token, licenseNumber, contactName?, contactEmail? }
//                     → converts the prospect into a PENDING DealerApplication
//
// This closes the recruitment funnel's manual midpoint: a prospect we sourced
// and emailed can self-convert without re-typing their dealership details.
// Approval still gates account creation (the application lands PENDING).

import { NextRequest, NextResponse } from "next/server";
import {
  getProspectByClaimToken,
  claimProspectToApplication,
} from "@/lib/services/dealer-recruitment/prospect-claim.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const prefill = await getProspectByClaimToken(token);
  if (!prefill) {
    return NextResponse.json({ error: "Invalid or expired claim link." }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: prefill });
}

export async function POST(request: NextRequest) {
  let body: { token?: string; licenseNumber?: string; contactName?: string; contactEmail?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.token || !body.licenseNumber) {
    return NextResponse.json({ error: "token and licenseNumber are required." }, { status: 400 });
  }

  const result = await claimProspectToApplication(body.token, {
    licenseNumber: body.licenseNumber,
    contactName: body.contactName,
    contactEmail: body.contactEmail,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(
    {
      success: true,
      data: {
        applicationId: result.applicationId,
        alreadyConverted: result.alreadyConverted,
        message: "Application received — our team will confirm your dealership shortly.",
      },
    },
    { status: result.alreadyConverted ? 200 : 201 },
  );
}
