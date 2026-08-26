import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { limitGeneral, clientIpKey } from "@/lib/security/rate-limit";
import {
  validateResumeToken,
  consumeResumeToken,
} from "@/lib/services/buyer/request-resume-token.service";

export const dynamic = "force-dynamic";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

interface Params {
  params: Promise<{ token: string }>;
}

// GET /api/public/request/resume/[token]
//
// The $99 pre-checkout resume link. Validates the opaque token (no PII in the
// URL), consumes it single-use (race-safe), and 302-redirects the lead into the
// auth-gated $99 checkout for their preserved request. The token confers NO
// authenticated capability — it is a deep-link only. The buyer's own Supabase
// session (and the existing guest-request email transfer at signup) remain the
// real access boundary, so a stolen/guessed token cannot view or claim another
// buyer's request; it can only reach the shared, auth-gated /buyer/deposit.
export async function GET(request: NextRequest, { params }: Params) {
  const { token } = await params;

  // Hygiene throttle by IP (256-bit tokens are unguessable; this bounds abuse of
  // the endpoint). General limiter fails open on store outage — safe for a
  // capability-free redirect.
  const rl = await limitGeneral(`request-resume:ip:${clientIpKey(request.headers)}`);
  if (!rl.ok) {
    return NextResponse.redirect(`${APP_URL}/request-a-car?resume=throttled`, { status: 302 });
  }

  const v = await validateResumeToken(token);
  if (!v.ok) {
    // Not found / expired / already consumed → send them to request a fresh link.
    // No detail leaked (same destination for every failure reason).
    return NextResponse.redirect(`${APP_URL}/request-a-car?resume=expired`, { status: 302 });
  }

  // Consume single-use. A lost race (concurrent click already consumed) is fine —
  // consuming grants nothing; we still route to the auth-gated checkout.
  await consumeResumeToken(v.tokenId).catch((err) =>
    logger.error("[request/resume] consume failed:", err),
  );

  // Into the preserved request's $99 checkout. Unauthenticated leads hit the
  // existing buyer auth gate (sign-in/claim, which transfers their guest request
  // by email), then land here. No vehicle info is re-entered.
  return NextResponse.redirect(`${APP_URL}/buyer/deposit?resume=1`, { status: 302 });
}
