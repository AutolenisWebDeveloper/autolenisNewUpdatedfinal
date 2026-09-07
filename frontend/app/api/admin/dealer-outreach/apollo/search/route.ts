// POST /api/admin/dealer-outreach/apollo/search — the FREE Apollo People Search
// entry point, plus the rooftop resolution that makes its results usable.
//
// WHY THIS ROUTE EXISTS. runPeopleSearch and matchApolloOrgToRooftop have been
// implemented and unit-tested since Phase 1, but nothing on the web could reach
// them, so apollo_person_candidates stayed empty and the enrichment path had
// nothing to enrich. This is that caller.
//
// COST: ZERO, STRUCTURALLY. Apollo bills for reveal, not for search. This route
// reaches only peopleSearchByCriteria (the free discovery seam, deliberately
// kept out of the reveal client's interface) and the rooftop matcher, which is
// pure database work. It imports nothing from the credit ledger and nothing that
// can draw from it, and the route test asserts that by making every ledger
// export throw.
//
// Admin + MFA is enforced server-side by getAdminFromRequest, mirroring the
// coverage route (it rejects a token without mfaVerified). This route also
// applies the OPERATIONAL_ROLES gate the other mutating dealer-outreach routes
// use — it writes candidate rows and can create rooftops, so read-only support
// staff must not reach it.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, OPERATIONAL_ROLES, createAuditLog } from "@/lib/auth/admin-api";
import type { AdminRole } from "@prisma/client";
import { runPeopleSearchAndMatch } from "@/lib/services/dealer-recruitment/apollo-orchestration.service";
import { MAX_SEARCH_PAGES, SEARCH_PAGE_SIZE } from "@/lib/services/dealer-recruitment/apollo-people-search.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A page is an Apollo round-trip plus up to SEARCH_PAGE_SIZE upserts, and the
// rooftop resolution pass follows it. Sized like the other long admin jobs.
export const maxDuration = 300;

/**
 * Default page budget for ONE request. Far below the service ceiling of
 * MAX_SEARCH_PAGES: an operator asking for a market should get a bounded batch
 * back inside the function timeout, and can raise it deliberately. The service
 * clamps anything larger to its own hard ceiling regardless.
 */
export const DEFAULT_ROUTE_MAX_PAGES = 5;

/** Bound on locations per call — a request is a market, not the whole country. */
export const MAX_LOCATIONS = 20;

interface Body {
  /** Apollo `organization_locations` values, e.g. ["Texas, US"]. */
  states?: unknown;
  maxPages?: unknown;
}

// The SIC code and title list are NOT overridable from the request. They are the
// vetted dealer criteria (SIC 5511 + the decision-maker titles) that the service
// defaults to, and a mistyped SIC would populate candidates — and create
// rooftops — for businesses that are not dealerships at all. Changing the
// criteria is a code change, reviewed, not a request parameter.

/** Non-empty trimmed strings only; anything else is rejected, never coerced. */
function stringList(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0 || value.length > max) return null;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    if (!trimmed) return null;
    out.push(trimmed);
  }
  return out;
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!OPERATIONAL_ROLES.includes(admin.role as AdminRole)) {
    return adminError("FORBIDDEN", "This role cannot run Apollo discovery", 403);
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return adminError("INVALID_JSON", "Invalid JSON body", 400);
  }

  const states = stringList(body.states, MAX_LOCATIONS);
  if (!states) {
    return adminError(
      "INVALID_STATES",
      `states must be 1-${MAX_LOCATIONS} non-empty location strings as Apollo expects them (e.g. "Texas, US")`,
      400,
    );
  }

  let maxPages = DEFAULT_ROUTE_MAX_PAGES;
  if (body.maxPages !== undefined) {
    const raw = Number(body.maxPages);
    if (!Number.isFinite(raw) || raw < 1) {
      return adminError("INVALID_MAX_PAGES", "maxPages must be a positive number", 400);
    }
    maxPages = Math.min(Math.floor(raw), MAX_SEARCH_PAGES);
  }

  try {
    const result = await runPeopleSearchAndMatch({ organizationLocations: states, maxPages });

    // Audited because it writes candidate rows and can create rooftops. Failing
    // to audit is not a reason to fail the run, so the write is best-effort.
    await createAuditLog(admin, request, {
      action: "APOLLO_PEOPLE_SEARCH",
      entityType: "ApolloPersonCandidate",
      entityId: result.search.searchRunKey,
      metadata: {
        states,
        maxPages,
        persisted: result.search.persisted,
        strongMatch: result.match.strongMatch,
      },
    }).catch(() => {});

    return adminSuccess({
      ...result,
      // Stated rather than implied: an operator reading this must not have to
      // infer from a zero whether the run was free or simply disabled.
      spendsCredits: false,
      pageSize: SEARCH_PAGE_SIZE,
      skippedReason: result.search.skipped
        ? "APOLLO_PEOPLE_SEARCH_ENABLED is not \"true\", or APOLLO_API_KEY is unset — nothing was searched or written"
        : null,
    });
  } catch (err) {
    return adminError(
      "SEARCH_FAILED",
      err instanceof Error ? err.message : "Apollo people search failed",
      500,
    );
  }
}
