// app/api/public/referral/track/route.ts
// Group 8 (8A) — public endpoint that records an affiliate referral click.
//
// Lives under /api/public/ on purpose: anonymous visitors landing with ?ref=
// have no session and no CSRF token, and proxy.ts exempts /api/public/* from
// CSRF for exactly this reason. The handler is intentionally forgiving — it
// always returns 200 so a tracking hiccup never surfaces on the visitor's page.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { trackClick } from "@/lib/services/affiliate/referral.service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const referralCode =
      typeof body?.referralCode === "string" ? body.referralCode.trim() : "";

    if (!referralCode || referralCode.length < 4) {
      return NextResponse.json({ ok: false, tracked: false }, { status: 200 });
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      null;

    const result = await trackClick({
      referralCode,
      ip,
      userAgent: request.headers.get("user-agent"),
      referer: typeof body?.referer === "string" ? body.referer : request.headers.get("referer"),
      landingPath: typeof body?.landingPath === "string" ? body.landingPath : null,
      utmSource: typeof body?.utmSource === "string" ? body.utmSource : null,
      utmMedium: typeof body?.utmMedium === "string" ? body.utmMedium : null,
      utmCampaign: typeof body?.utmCampaign === "string" ? body.utmCampaign : null,
    });

    return NextResponse.json({ ok: true, tracked: result.tracked }, { status: 200 });
  } catch (err) {
    logger.error("[group-8] /api/public/referral/track failed:", err);
    // Never surface a tracking error to the visitor.
    return NextResponse.json({ ok: false, tracked: false }, { status: 200 });
  }
}
