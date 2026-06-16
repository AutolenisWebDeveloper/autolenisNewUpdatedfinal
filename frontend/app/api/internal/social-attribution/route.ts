// POST /api/internal/social-attribution
// Internal endpoint called by the buyer intake flow to capture UTM attribution.
// Protected by CRON_SECRET so it is not publicly accessible.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { captureUtmAttribution } from "@/lib/social/attribution.service";
import { z } from "zod";

const schema = z.object({
  vehicleRequestId: z.string(),
  buyerOpportunityId: z.string(),
  utmParams: z
    .object({
      utmSource: z.string().optional(),
      utmMedium: z.string().optional(),
      utmCampaign: z.string().optional(),
      utmContent: z.string().optional(),
      utmTerm: z.string().optional(),
      utmHook: z.string().optional(),
      utmPlatform: z.string().optional(),
      utmCreator: z.string().optional(),
      utmAffiliate: z.string().optional(),
    })
    .optional(),
});

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization") ?? "";
    if (!auth.endsWith(secret)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const { vehicleRequestId, buyerOpportunityId, utmParams } = parsed.data;

  try {
    await captureUtmAttribution({
      vehicleRequestId,
      buyerOpportunityId,
      ...utmParams,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("[social-attribution] error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "Attribution capture failed" }, { status: 500 });
  }
}
