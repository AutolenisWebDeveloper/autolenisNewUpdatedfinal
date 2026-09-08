// POST /api/admin/dealer-outreach/apollo/enrich — preview or execute a
// credit-budgeted Apollo enrichment run.
//
// PREVIEW IS THE DEFAULT, AND IT IS NOT A FORMALITY. An omitted mode previews;
// only mode="execute" can spend, and execute additionally requires an explicit
// maxCredits in the body. A number the operator had to type is the difference
// between authorizing a spend and clicking a button.
//
// THE CAPS ARE THE SERVICE'S, NOT THIS ROUTE'S. The effective ceiling is the
// minimum of the requested maxCredits, APOLLO_ENRICHMENT_MAX_CREDITS, and what
// the monthly ledger reports remaining. This route validates input and maps
// outcomes; it never widens a cap and never sets includeWeakMatches, so a
// low-confidence or freshly-created rooftop link is never paid for.
//
// STILL FAIL-CLOSED. Even a well-formed execute spends nothing unless the owner
// has set APOLLO_ENRICHMENT_ENABLED=true (the job's own gate) and
// APOLLO_REVEAL_ENABLED=true (without it no Apollo client exists, so no reveal
// implementation is supplied and the run aborts before its loop).
//
// Admin + MFA enforced server-side via getAdminFromRequest, mirroring the
// coverage route, plus the OPERATIONAL_ROLES gate the other mutating
// dealer-outreach routes use — this one can move money.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, OPERATIONAL_ROLES, createAuditLog } from "@/lib/auth/admin-api";
import type { AdminRole } from "@prisma/client";
import {
  previewApolloEnrichment,
  executeApolloEnrichment,
} from "@/lib/services/dealer-recruitment/apollo-orchestration.service";
import {
  waterfallEnabled,
  resolveMaxCredits,
} from "@/lib/services/dealer-recruitment/apollo-enrichment-job.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// One reveal per candidate up to the cap, each a live Apollo round-trip.
export const maxDuration = 300;

const MODES = ["preview", "execute"] as const;
type Mode = (typeof MODES)[number];

interface Body {
  mode?: unknown;
  maxCredits?: unknown;
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!OPERATIONAL_ROLES.includes(admin.role as AdminRole)) {
    return adminError("FORBIDDEN", "This role cannot run Apollo enrichment", 403);
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return adminError("INVALID_JSON", "Invalid JSON body", 400);
  }

  // Omitted → preview. Present but unrecognised → refused: a typo'd mode must
  // never fall through to the cheaper branch and look like it ran the run the
  // operator asked for.
  let mode: Mode = "preview";
  if (body.mode !== undefined) {
    if (typeof body.mode !== "string" || !MODES.includes(body.mode as Mode)) {
      return adminError("INVALID_MODE", `mode must be one of: ${MODES.join(", ")}`, 400);
    }
    mode = body.mode as Mode;
  }

  // maxCredits is optional for a preview (it falls back to the configured cap)
  // and MANDATORY for an execute.
  let maxCredits: number | undefined;
  if (body.maxCredits !== undefined) {
    const raw = Number(body.maxCredits);
    if (!Number.isFinite(raw) || raw <= 0) {
      return adminError("INVALID_MAX_CREDITS", "maxCredits must be a positive number", 400);
    }
    maxCredits = Math.floor(raw);
  }
  if (mode === "execute" && maxCredits === undefined) {
    return adminError(
      "MAX_CREDITS_REQUIRED",
      "execute requires an explicit maxCredits in the body — a spend is never implied by a default",
      400,
    );
  }

  // The reveal wired here is the deterministic single-credit people/match call,
  // which passes no waterfall parameters. If the waterfall flag were on, the
  // preview would quote the 8x worst case while the run spent 1x per contact —
  // an operator authorizing a number that does not describe the run. Refuse
  // rather than reconcile the two silently.
  if (mode === "execute" && waterfallEnabled()) {
    return adminError(
      "WATERFALL_UNSUPPORTED",
      "APOLLO_WATERFALL_ENABLED is true, but the wired reveal is the standard single-credit " +
        "people/match call. The preview's worst-case estimate would not describe this run. " +
        "Unset APOLLO_WATERFALL_ENABLED to execute.",
      409,
    );
  }

  try {
    if (mode === "preview") {
      const preview = await previewApolloEnrichment({ maxCredits, startedBy: admin.email });
      return adminSuccess({
        mode,
        preview,
        spendsCredits: false,
        configuredMaxCredits: resolveMaxCredits(),
      });
    }

    const run = await executeApolloEnrichment({ maxCredits, startedBy: admin.email });

    // entityId is the ApolloEnrichmentRun row, so the audit entry points at the
    // record that carries the spend. Null only if that row itself failed to
    // write, which the service logs as an error.
    await createAuditLog(admin, request, {
      action: "APOLLO_ENRICHMENT_EXECUTE",
      entityType: "ApolloEnrichmentRun",
      entityId: run.runId ?? "unrecorded",
      metadata: {
        requestedMaxCredits: maxCredits,
        effectiveMaxCredits: run.maxCredits,
        // creditsDrawn is the gross the cap bounded; creditsSpent is the NET
        // the run took from ApolloCreditLedger; creditsRefunded is what came
        // back for clean no-matches. All three are recorded so the audit row
        // explains the ledger without the run row.
        creditsDrawn: run.creditsDrawn,
        creditsSpent: run.creditsSpent,
        creditsRefunded: run.creditsRefunded,
        enrichedCount: run.enrichedCount,
        status: run.status,
        abortReason: run.abortReason ?? null,
      },
    }).catch(() => {});

    return adminSuccess({ mode, run, configuredMaxCredits: resolveMaxCredits() });
  } catch (err) {
    return adminError(
      "ENRICHMENT_FAILED",
      err instanceof Error ? err.message : "Apollo enrichment failed",
      500,
    );
  }
}
