// POST /api/internal/social-attribution
// Internal endpoint called by the buyer intake flow to capture UTM attribution.
// Protected by CRON_SECRET so it is not publicly accessible.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
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
  // Fail closed: a missing secret must deny (500), never expose this internal
  // attribution writer publicly. Match the strict full-string Bearer compare
  // used by every cron route rather than a permissive endsWith().
  if (!secret) {
    logger.error("[social-attribution] CRON_SECRET not configured — denying");
    return NextResponse.json(
      { success: false, error: "Server misconfigured" },
      { status: 500 },
    );
  }
  // Accept the standard `Authorization: Bearer <secret>` form, or a bare secret
  // for the external intake caller. Use exact equality — never endsWith(), which
  // a token like "<anything><secret>" would satisfy.
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isAuthorized =
    auth === `${CRON_AUTH_PREFIX}${secret}` || auth === secret;
  if (!isAuthorized) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
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
