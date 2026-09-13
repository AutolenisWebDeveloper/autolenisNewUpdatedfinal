import { requireAdmin } from "@/lib/auth/admin-session";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Gavel } from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  getSourcingCaseById,
  SOURCING_CASE_STATUS,
  effectiveRadiusMiles,
} from "@/lib/services/sourcing/sourcing-case.service";
import { evaluateReadiness } from "@/lib/services/sourcing/launch-readiness.service";
import {
  MIN_AUTO_LAUNCH_FIELD,
  MIN_LIMITED_AUCTION_FIELD,
  nextBandIsSearchable,
} from "@/lib/services/sourcing/rooftop-sourcing.service";
import { bandRungs } from "@/lib/services/sourcing/sourcing-buyer-view";
import { CARD, EYEBROW } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";
import ReadinessChecklist from "@/components/admin/ReadinessChecklist";
import LimitedAuctionApproval from "@/components/admin/LimitedAuctionApproval";

// S6-24 / S6-27 / S7-22 — the Operations destination for one sourcing case.
//
// WHY THIS PAGE EXISTS AND WHAT IT IS NOT. Phase 5 raises two exception codes that land an
// Operations task in `/admin/queues` — `THIN_DEALER_COVERAGE` and `LAUNCH_READINESS_BLOCKED` —
// and §26 requires every exception to name a return point. The queue was already the entry
// point; what was missing was the destination. So this is a DRILL-DOWN off the request
// workflow, registered in `lib/admin/nav.ts` DETAIL_PARENTS against
// `/admin/requests/[requestId]`, and NOT a new rail entry. A menu cannot usefully list "a
// sourcing case", and a second sourcing navigation would be the competing system the
// information-architecture rule forbids.
//
// IT SHOWS THE SAME READINESS ANSWER THE LAUNCH USES. `evaluateReadiness` is pure with respect
// to the auction — it creates nothing and sends nothing — which is exactly why an operator can
// be shown the live checklist rather than a re-derived one. An admin screen that computed
// readiness its own way would eventually disagree with the launch, and the operator would be
// approving against a checklist the launch does not honour.
//
// THE APPROVAL IS THE ROUTE'S, NOT THIS PAGE'S. `POST /api/admin/sourcing/[caseId]/limited-auction`
// enforces all four §6c conditions server-side, three of them as refusals. This page shows the
// operator which of the four currently hold so the refusal is not a surprise, and then calls
// that route — it does not pre-authorise anything, and a condition that looks satisfied here is
// still re-checked there.

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ caseId: string }>;
}

export default async function AdminSourcingCasePage({ params }: Props) {
  const { caseId } = await params;
  await requireAdmin();

  const sourcingCase = await getSourcingCaseById(caseId);
  if (!sourcingCase) notFound();

  const req = await prisma.vehicleRequest.findUnique({
    where: { id: sourcingCase.vehicleRequestId },
    select: {
      id: true,
      status: true,
      makePreference: true,
      modelPreference: true,
      yearMin: true,
      yearMax: true,
      // The buyer's EMAIL lives on `users`, not on `buyers` — the Buyer row carries the name and
      // the User row the credential. Selected through the relation rather than assumed.
      buyer: { select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } } },
    },
  });

  // READINESS IS EVALUATED, NOT ASSUMED — and a failure to evaluate renders as a failure.
  // A try/catch that fell back to "not ready" would tell an operator the case is blocked when
  // the truth is that we could not tell, which is the confident-empty this programme keeps
  // banning.
  let readiness: Awaited<ReturnType<typeof evaluateReadiness>> | null = null;
  let readinessError: string | null = null;
  try {
    // READ-ONLY: `raiseOnFailure` stays false so rendering this page cannot write a queue item.
    // It used to — a failed approval recheck raised `PREQUAL_APPROVAL_EXPIRED` as a side effect of
    // a GET, which is not what `evaluateReadiness`' own "pure with respect to the auction" header
    // promised. Found by the independent review. `launchFromCase` passes true, because a launch
    // that holds on an expired approval SHOULD leave somebody a task.
    readiness = await evaluateReadiness(
      sourcingCase.vehicleRequestId,
      sourcingCase,
      undefined,
      undefined,
      { raiseOnFailure: false },
    );
  } catch (err) {
    readinessError = err instanceof Error ? err.message : "Unknown error evaluating readiness";
  }

  const candidates = await prisma.sourcingCandidate.count({
    where: { sourcingCaseId: sourcingCase.id },
  });
  const auction = await prisma.auction.findFirst({
    where: { vehicleRequestId: sourcingCase.vehicleRequestId },
    select: { id: true, status: true },
  });

  const rungs = bandRungs(sourcingCase);
  const reach = effectiveRadiusMiles(sourcingCase.band, sourcingCase.authorizedRadiusMiles);
  const furtherBandSearchable = nextBandIsSearchable(sourcingCase.band, sourcingCase.authorizedRadiusMiles);
  const vehicle =
    [req?.makePreference, req?.modelPreference].filter(Boolean).join(" ") || "Vehicle unspecified";
  const buyerName = [req?.buyer?.firstName, req?.buyer?.lastName].filter(Boolean).join(" ");

  return (
    <div className="max-w-4xl p-6 md:p-8" data-testid="admin-sourcing-case-page">
      <Link
        href={`/admin/requests/${sourcingCase.vehicleRequestId}`}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-800"
        data-testid="back-to-request"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Back to the request
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={EYEBROW}>Sourcing case</p>
          <h1 className="mt-1 text-xl font-bold text-slate-900">{vehicle}</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {/* The admin surface is INSIDE the firewall: §25.1 withholds the buyer from the
                DEALER, not from Operations, who have to be able to act on the case. */}
            {buyerName || req?.buyer?.user?.email || "Buyer unknown"} · case {sourcingCase.id}
          </p>
        </div>
        {auction && (
          <Link
            href={`/admin/auctions/${auction.id}`}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            data-testid="sourcing-case-auction-link"
          >
            <Gavel size={14} aria-hidden="true" /> Auction ({auction.status})
          </Link>
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <section className={cn(CARD, "p-5")} data-testid="sourcing-case-state">
          <p className={EYEBROW}>State</p>
          <dl className="mt-3 space-y-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Status</dt>
              <dd className="font-semibold text-slate-900" data-testid="case-status">
                {sourcingCase.status}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Band</dt>
              <dd className="font-medium text-slate-800">{sourcingCase.band}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Searching to</dt>
              <dd className="font-medium text-slate-800" data-testid="case-reach">
                {reach === null ? "— (no authorisation)" : `${reach} mi`}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Invitation-ready field</dt>
              <dd className="font-mono font-bold tabular-nums text-slate-900" data-testid="case-coverage-count">
                {sourcingCase.coverageCount}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Rooftops examined</dt>
              <dd className="font-mono tabular-nums text-slate-700">{candidates}</dd>
            </div>
            {sourcingCase.authorizedRadiusMiles !== null && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Buyer authorised</dt>
                <dd className="font-medium text-slate-800">{sourcingCase.authorizedRadiusMiles} mi</dd>
              </div>
            )}
            {sourcingCase.closedAt && (
              <div className="border-t border-slate-100 pt-2.5">
                <dt className="text-slate-500">Closed</dt>
                <dd className="mt-0.5 text-slate-800">{sourcingCase.closeReason ?? "No reason recorded"}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className={cn(CARD, "p-5")} data-testid="sourcing-case-ladder">
          <p className={EYEBROW}>Ladder</p>
          <ol className="mt-3 space-y-2 text-sm">
            {rungs.map((r) => (
              <li key={r.band} className="flex items-center justify-between gap-3" data-state={r.state}>
                <span
                  className={cn(
                    r.state === "CURRENT" && "font-semibold text-slate-900",
                    r.state === "DONE" && "text-slate-500",
                    r.state === "PENDING" && "text-slate-400",
                    r.state === "NEEDS_AUTHORIZATION" && "font-semibold text-amber-700",
                  )}
                >
                  {r.label}
                </span>
                <span className="text-xs uppercase tracking-wide text-slate-400">
                  {r.state.toLowerCase().replace(/_/g, " ")}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            {furtherBandSearchable
              ? "A further band is still searchable — §6c's limited-auction approval is refused while one remains."
              : "The permitted radius is completely searched."}
          </p>
        </section>
      </div>

      {readinessError ? (
        <section className={cn(CARD, "mt-5 border-red-200 p-5")} data-testid="readiness-error">
          <p className="text-sm font-semibold text-red-700">Readiness could not be evaluated</p>
          <p className="mt-1 text-sm text-slate-600">
            This is a failure to read, not a finding of &ldquo;not ready&rdquo;. Nothing about this case
            has been established.
          </p>
          <p className="mt-2 font-mono text-xs text-slate-500">{readinessError}</p>
        </section>
      ) : (
        readiness && (
          <ReadinessChecklist
            items={readiness.items}
            ready={readiness.ready}
            fieldSize={readiness.field.length}
          />
        )
      )}

      {sourcingCase.status === SOURCING_CASE_STATUS.LIMITED_PENDING_APPROVAL && (
        <LimitedAuctionApproval
          caseId={sourcingCase.id}
          fieldSize={sourcingCase.coverageCount}
          minLimited={MIN_LIMITED_AUCTION_FIELD}
          minAuto={MIN_AUTO_LAUNCH_FIELD}
          furtherBandSearchable={furtherBandSearchable}
          alreadyApprovedAt={
            sourcingCase.limitedAuctionApprovedAt
              ? sourcingCase.limitedAuctionApprovedAt.toISOString()
              : null
          }
        />
      )}
    </div>
  );
}
