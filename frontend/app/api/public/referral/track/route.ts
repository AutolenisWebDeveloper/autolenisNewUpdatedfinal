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
import { limitAuthAttempt, clientIpKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // M13 — this endpoint is anonymous and writes a row per call; without a
    // limit one source can inflate click stats and grow the table without
    // bound. Generous ceiling (a human never hits it), keyed by IP; a limited
    // request still answers 200/untracked so nothing surfaces on the page.
    const limited = await limitAuthAttempt(`referral-track:${clientIpKey(request.headers)}`, {
      tokens: 30,
      window: "10 m",
    });
    if (!limited.ok) {
      return NextResponse.json({ ok: false, tracked: false }, { status: 200 });
    }

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
