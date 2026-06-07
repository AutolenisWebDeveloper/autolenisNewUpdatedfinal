import { NextRequest, NextResponse } from "next/server";

import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { markContentConversion } from "@/lib/analytics/content-attribution.server";

// Phase C-Attribution — server-side conversion hook.
//
// A deposit/deal webhook (or any internal job) POSTs here once a content-engine
// lead converts, so its ContentAttribution row(s) are marked converted even
// when the lead can't be auto-reconciled from the linked BuyerOpportunity
// (e.g. Dealer Fee Calculator leads, which carry no buyer link). Matched by
// buyerOpportunityId when known, otherwise by buyer email.
//
// Auth: the platform's internal secret (same header/secret as cron). Lives
// under /api/webhooks/* so the edge middleware treats it as a self-guarded
// webhook (CSRF-exempt, no session required).

export async function POST(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isValidSecret =
    !!process.env.CRON_SECRET &&
    auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "invalid_json" }, { status: 400 });
  }

  const buyerOpportunityId =
    typeof body.buyerOpportunityId === "string" ? body.buyerOpportunityId : null;
  const email = typeof body.email === "string" ? body.email : null;
  const conversionValueCents =
    typeof body.conversionValueCents === "number" ? body.conversionValueCents : null;

  if (!buyerOpportunityId && !email) {
    return NextResponse.json(
      { success: false, error: "buyerOpportunityId_or_email_required" },
      { status: 400 },
    );
  }

  const updated = await markContentConversion({
    buyerOpportunityId,
    email,
    conversionValueCents,
  });

  return NextResponse.json({ success: true, updated });
}
