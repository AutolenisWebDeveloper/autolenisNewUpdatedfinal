// POST /api/admin/dealer-outreach/apollo/probe — one-shot live check of the
// Apollo endpoints the reveal path depends on.
//
// WHY A ROUTE. CI cannot reach api.apollo.io and there is no staging tenant, so
// the corrected organization-resolution and people-search contract can only be
// proven from production, by an admin, by looking at the raw envelopes. This
// route runs runApolloContractProbe — a FIXED list of three rooftops, one
// organization resolution and one people search each, never people/match — and
// returns every status and body verbatim.
//
// IT SPENDS, SO IT IS GATED THREE WAYS: admin + MFA (getAdminFromRequest), the
// OPERATIONAL_ROLES gate the other spending dealer-outreach routes use, and an
// explicit `acknowledgeSpend: true` in the body naming the ceiling. The ceiling
// itself is a constant (PROBE_MAX_CREDITS) drawn from the ledger before each
// paid call; the paid tier must be enabled, exactly as for a reveal.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, OPERATIONAL_ROLES, createAuditLog } from "@/lib/auth/admin-api";
import type { AdminRole } from "@prisma/client";
import {
  runApolloContractProbe,
  PROBE_MAX_CREDITS,
  PROBE_ROOFTOPS,
} from "@/lib/services/dealer-recruitment/apollo-contract-probe.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Six live Apollo round-trips at most, each bounded by the adapter timeout.
export const maxDuration = 120;

interface Body {
  acknowledgeSpend?: unknown;
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!OPERATIONAL_ROLES.includes(admin.role as AdminRole)) {
    return adminError("FORBIDDEN", "This role cannot run the Apollo contract probe", 403);
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return adminError("INVALID_JSON", "Invalid JSON body", 400);
  }

  // A number the operator had to read and type back. The probe is one-shot by
  // construction, but "one-shot" is not "free".
  if (body.acknowledgeSpend !== true) {
    return adminError(
      "ACKNOWLEDGE_SPEND_REQUIRED",
      `The probe resolves ${PROBE_ROOFTOPS.length} fixed rooftops and may bill up to ${PROBE_MAX_CREDITS} ` +
        "credit(s) (1 per organization found; a not-found is free). Send { acknowledgeSpend: true } to run it.",
      400,
    );
  }

  try {
    const result = await runApolloContractProbe();
    if (!result) {
      return adminError(
        "APOLLO_DISABLED",
        "The paid tier is off (APOLLO_API_KEY unset or APOLLO_REVEAL_ENABLED is not \"true\"). " +
          "The probe's organization resolution bills, so it honours the same gate as a reveal.",
        409,
      );
    }

    await createAuditLog(admin, request, {
      action: "APOLLO_CONTRACT_PROBE",
      entityType: "ApolloCreditLedger",
      entityId: result.cycleKey,
      metadata: {
        maxCredits: result.maxCredits,
        creditsDrawn: result.creditsDrawn,
        creditsKept: result.creditsKept,
        endpointsTouched: result.endpointsTouched,
        organizationsResolved: result.rooftops.filter((r) => r.organizationId).length,
      },
    }).catch(() => {});

    return adminSuccess(result);
  } catch (err) {
    return adminError("PROBE_FAILED", err instanceof Error ? err.message : "Apollo contract probe failed", 500);
  }
}
