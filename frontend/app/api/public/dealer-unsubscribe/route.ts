import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-service";
import { SuppressionService } from "@/lib/services/suppression.service";
import { verifyUnsubscribeToken } from "@/lib/services/dealer-recruitment/unsubscribe-token.service";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// One-click unsubscribe for dealer cold outreach.
//   POST — RFC 8058 List-Unsubscribe-Post one-click. Mail providers call this
//          with no user interaction; it must not require auth and must be
//          idempotent. Returns 200 with an empty body.
//   GET  — a human clicking the footer link; suppresses and renders a small
//          confirmation page.
// Both paths verify the HMAC token (no enumeration) and write email_suppression
// with reason "unsubscribed" (email-only; does not set do_not_contact).

async function suppress(token: string | null): Promise<{ ok: boolean; email?: string }> {
  if (!token) return { ok: false };
  const email = verifyUnsubscribeToken(token);
  if (!email) return { ok: false };
  try {
    const supabase = getServiceSupabase();
    await SuppressionService.suppressEmail(supabase, email, "unsubscribed", {
      source: "dealer_outreach_one_click",
    });
    return { ok: true, email };
  } catch (err) {
    logger.error("[dealer-unsubscribe] suppression write failed:", err);
    return { ok: false, email };
  }
}

export async function POST(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token");
  const { ok } = await suppress(token);
  // RFC 8058: a 2xx is the signal of success; body is ignored by mail clients.
  return new NextResponse(null, { status: ok ? 200 : 400 });
}

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token");
  const { ok, email } = await suppress(token);

  const body = ok
    ? `<h1>You're unsubscribed</h1><p>${email ? escapeHtml(email) : "Your address"} has been removed from AutoLenis dealer outreach emails. It may take a moment to take full effect.</p>`
    : `<h1>Unsubscribe link invalid</h1><p>This link is invalid or has expired. To opt out, reply to any AutoLenis email with the word <strong>UNSUBSCRIBE</strong> and we'll remove you.</p>`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex"/><title>Unsubscribe · AutoLenis</title><style>body{font-family:-apple-system,system-ui,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:48px 16px;line-height:1.6}main{max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;box-shadow:0 1px 2px rgba(0,0,0,.04)}h1{font-size:20px;margin:0 0 12px}p{font-size:14px;color:#475569;margin:0}strong{color:#0f172a}</style></head><body><main>${body}</main></body></html>`;

  return new NextResponse(html, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
