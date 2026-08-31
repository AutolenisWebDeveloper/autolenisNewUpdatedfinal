// POST /api/admin/dealer-outreach/send-sms
//
// SHIPPED OFF. DEALER_OUTREACH_SMS_ENABLED defaults to unset, so this route
// refuses every request and records the refusal. That is not a placeholder:
// dealer contact profiles carry consent_basis NONE, and messaging a
// vendor-sourced number with no consent record is a counsel decision, not an
// engineering one. The path is built in full so that decision is a config
// change reviewed against working code rather than a rush job later.
//
// The route is THIN by design. Every gate — consent basis, DNC, phone type,
// suppression, quiet hours, idempotency — lives in the service and the shared
// consent module. Re-implementing any of them here would create the second
// enforcement plane this branch exists to avoid.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, OPERATIONAL_ROLES } from "@/lib/auth/admin-api";
import type { AdminRole } from "@prisma/client";
import {
  sendDealerSms,
  type DealerSmsReason,
} from "@/lib/services/dealer-recruitment/dealer-sms-send.service";
import { dealerSmsProductionDeps } from "@/lib/services/dealer-recruitment/dealer-sms-wiring";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

// A blocked send is a 409: the request was well-formed and authorized, and the
// system refused it on policy. Returning 400 would invite a caller to "fix" the
// input; returning 200 would hide it.
const STATUS: Record<DealerSmsReason, { status: number; code: string }> = {
  not_found: { status: 404, code: "NOT_FOUND" },
  invalid_phone: { status: 409, code: "INVALID_PHONE" },
  send_disabled: { status: 409, code: "SEND_DISABLED" },
  already_contacted: { status: 409, code: "ALREADY_CONTACTED" },
  no_consent_basis: { status: 409, code: "NO_CONSENT_BASIS" },
  dnc_blocked: { status: 409, code: "DNC_BLOCKED" },
  phone_type_blocked: { status: 409, code: "PHONE_TYPE_BLOCKED" },
  suppressed: { status: 409, code: "SUPPRESSED" },
  quiet_hours: { status: 409, code: "QUIET_HOURS" },
  not_configured: { status: 503, code: "NOT_CONFIGURED" },
  send_error: { status: 502, code: "SEND_ERROR" },
};

interface Body {
  prospectId?: string;
  body?: string;
  step?: number;
}

export async function POST(request: NextRequest) {
  // One session lookup, two outcomes. getAdminWithRole re-runs
  // getAdminFromRequest internally, so calling both cost an extra database
  // round trip per request and still could not tell 401 from 403 on its own.
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!OPERATIONAL_ROLES.includes(admin.role as AdminRole)) {
    return adminError("FORBIDDEN", "This role cannot send dealer outreach", 403);
  }

  let payload: Body;
  try {
    payload = (await request.json()) as Body;
  } catch {
    return adminError("INVALID_JSON", "Invalid JSON body", 400);
  }

  if (!payload.prospectId) return adminError("MISSING_ID", "prospectId is required", 400);
  const body = payload.body?.trim();
  if (!body) return adminError("MISSING_BODY", "A non-empty message body is required", 400);

  const result = await sendDealerSms(
    { prospectId: payload.prospectId, body, step: payload.step },
    dealerSmsProductionDeps(),
  );

  if (!result.success) {
    const mapped = STATUS[result.reason ?? "send_error"] ?? STATUS.send_error;
    return adminError(mapped.code, result.error ?? "SMS refused", mapped.status);
  }
  return adminSuccess(result);
}
