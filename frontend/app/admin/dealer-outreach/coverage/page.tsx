// /admin/dealer-outreach/coverage — dealer contact-coverage census.
//
// Read-only ops readout answering: is the dealer population actually reachable,
// and what would the contact backfill (B′) do on its next run? Every figure is
// counted with the same predicate the backfill uses, so this page and the job
// can never disagree. Nothing here spends an Apollo credit or enables anything.
import { requireAdmin } from "@/lib/auth/admin-session";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Users,
  Store,
  MailCheck,
  AlertTriangle,
  Coins,
  Wallet,
  Power,
  Search,
  UserSearch,
  Link2,
  Sparkles,
} from "lucide-react";
import StatCard from "@/components/ui/patterns/StatCard";
import {
  getContactCoverage,
  type ContactCoverage,
} from "@/lib/services/dealer-recruitment/contact-coverage.service";
import {
  getApolloPipelineCounters,
  type ApolloPipelineCounters,
} from "@/lib/services/dealer-recruitment/apollo-orchestration.service";

export const dynamic = "force-dynamic";

const pct = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((part / whole) * 100)}% of ${whole.toLocaleString()}` : "no records yet";

export default async function DealerCoveragePage() {
  await requireAdmin();

  let coverage: ContactCoverage | null = null;
  let pipeline: ApolloPipelineCounters | null = null;
  let loadError: string | null = null;
  try {
    // Both are pure counts, so one round trip's worth of latency.
    [coverage, pipeline] = await Promise.all([getContactCoverage(), getApolloPipelineCounters()]);
  } catch (err) {
    // Show the real failure rather than fabricated zeros — a census that lies
    // is worse than one that is briefly unavailable.
    loadError = err instanceof Error ? err.message : "Failed to load coverage";
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="admin-dealer-coverage-page">
      <div className="mb-6">
        <Link
          href="/admin/dealer-outreach"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-al-primary transition-colors"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          Back to Dealer Recruitment
        </Link>
        <h1 className="text-xl font-bold text-slate-900 mt-2">Contact Coverage</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          How much of the dealer population has a send-safe contact, and what the contact backfill
          would process next. Read-only — this page never spends Apollo credits.
        </p>
      </div>

      {loadError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700"
          data-testid="coverage-error"
        >
          <p className="font-semibold">Coverage could not be loaded</p>
          <p className="mt-0.5 text-red-600">{loadError}</p>
        </div>
      )}

      {coverage && (
        <>
          {/* Rooftop coverage — the number that actually gates outreach. */}
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Rooftop coverage</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            <StatCard
              icon={Store}
              label="Canonical rooftops"
              value={coverage.rooftops.total.toLocaleString()}
              sub="distinct dealerships resolved"
              tone="brand"
              testId="stat-rooftops-total"
            />
            <StatCard
              icon={MailCheck}
              label="With a send-safe contact"
              value={coverage.rooftops.withSendSafeContact.toLocaleString()}
              sub={pct(coverage.rooftops.withSendSafeContact, coverage.rooftops.total)}
              tone="success"
              testId="stat-rooftops-covered"
            />
            <StatCard
              icon={AlertTriangle}
              label="Contact gap"
              value={coverage.rooftops.contactGap.toLocaleString()}
              sub={`${coverage.rooftops.contactGapReachable.toLocaleString()} reachable by paid reveal (has a domain)`}
              tone={coverage.rooftops.contactGap > 0 ? "warning" : "success"}
              testId="stat-rooftops-gap"
            />
          </div>

          {/* Population — how much is even visible to the rooftop-keyed backfill. */}
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Population resolution</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-2">
            <StatCard
              icon={Building2}
              label="Registered dealers"
              value={coverage.dealers.total.toLocaleString()}
              sub={`${coverage.dealers.withRooftop.toLocaleString()} linked to a rooftop`}
              tone="brand"
              testId="stat-dealers-total"
            />
            <StatCard
              icon={Building2}
              label="Dealers awaiting resolution"
              value={coverage.dealers.pendingResolution.toLocaleString()}
              sub="no rooftop yet"
              tone={coverage.dealers.pendingResolution > 0 ? "warning" : "success"}
              testId="stat-dealers-pending"
            />
            <StatCard
              icon={Users}
              label="Dealer prospects"
              value={coverage.prospects.total.toLocaleString()}
              sub={`${coverage.prospects.withRooftop.toLocaleString()} linked to a rooftop`}
              tone="indigo"
              testId="stat-prospects-total"
            />
            <StatCard
              icon={Users}
              label="Prospects awaiting resolution"
              value={coverage.prospects.pendingResolution.toLocaleString()}
              sub="excludes dead & onboarded"
              tone={coverage.prospects.pendingResolution > 0 ? "warning" : "success"}
              testId="stat-prospects-pending"
            />
          </div>
          <p className="text-xs text-slate-500 mb-8">
            {coverage.contactProfiles.total.toLocaleString()} contact profile
            {coverage.contactProfiles.total === 1 ? "" : "s"} stored,{" "}
            {coverage.contactProfiles.sendSafe.toLocaleString()} send-safe. A dealer and its prospect
            twin share one rooftop, so filling a rooftop covers both and is never billed twice.
          </p>

          {/* Apollo budget — the paid tier's guardrails, visible before enabling. */}
          <h2 className="text-sm font-semibold text-slate-900 mb-3">
            Apollo budget · cycle {coverage.apollo.cycleKey}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-2">
            <StatCard
              icon={Power}
              label="Paid reveal tier"
              value={coverage.apollo.enabled ? "Enabled" : "Off"}
              sub={coverage.apollo.enabled ? "reveals may draw credits" : "owner-gated; no spend possible"}
              tone={coverage.apollo.enabled ? "success" : "neutral"}
              testId="stat-apollo-enabled"
            />
            <StatCard
              icon={Power}
              label="Unattended backfill spend"
              value={coverage.apollo.backfillSpendEnabled ? "Armed" : "Off"}
              sub={
                coverage.apollo.backfillSpendEnabled
                  ? "the daily cron may draw credits with nobody watching"
                  : "cron resolves rooftops only; no scheduled reveal can bill"
              }
              tone={coverage.apollo.backfillSpendEnabled ? "warning" : "neutral"}
              testId="stat-apollo-backfill-armed"
            />
            <StatCard
              icon={Coins}
              label="Credits spent"
              value={coverage.apollo.spentCredits.toLocaleString()}
              sub={
                coverage.apollo.capCredits > 0
                  ? `of ${coverage.apollo.capCredits.toLocaleString()} cap`
                  : "no ledger row for this cycle"
              }
              tone="neutral"
              testId="stat-apollo-spent"
            />
            <StatCard
              icon={Wallet}
              label="Backfill budget left"
              value={coverage.apollo.backfillRemaining.toLocaleString()}
              sub="above the live reserve floor"
              tone={coverage.apollo.backfillRemaining > 0 ? "success" : "neutral"}
              testId="stat-apollo-remaining"
            />
            <StatCard
              icon={MailCheck}
              label="Reveals this cycle"
              value={coverage.apollo.revealsThisCycle.toLocaleString()}
              sub={`${coverage.apollo.revealedThisCycle.toLocaleString()} found · ${coverage.apollo.emptyThisCycle.toLocaleString()} empty`}
              tone="neutral"
              testId="stat-apollo-reveals"
            />
          </div>
          <p className="text-xs text-slate-500 mb-8">
            The contact backfill attempts only the {coverage.rooftops.contactGapReachable.toLocaleString()}{" "}
            gap rooftop{coverage.rooftops.contactGapReachable === 1 ? "" : "s"} carrying a website
            domain; Apollo&rsquo;s organization lookup has never resolved one without a domain.
          </p>

          {/* People Search pipeline — the free acquisition path, and what it has
              actually produced. Separate from the budget block above because
              searching spends nothing; only the last row can cost money. */}
          {pipeline && (
            <>
              <h2 className="text-sm font-semibold text-slate-900 mb-3">
                Apollo People Search pipeline
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-2">
                <StatCard
                  icon={Search}
                  label="Discovery (free search)"
                  value={pipeline.searchEnabled ? "Enabled" : "Off"}
                  sub={
                    pipeline.searchEnabled
                      ? "search runs cost no credits"
                      : "owner-gated; no candidates can be found"
                  }
                  tone={pipeline.searchEnabled ? "success" : "neutral"}
                  testId="stat-apollo-search-enabled"
                />
                <StatCard
                  icon={UserSearch}
                  label="Person candidates"
                  value={pipeline.candidates.total.toLocaleString()}
                  sub={
                    pipeline.search.latestRunKey
                      ? `latest run ${pipeline.search.latestRunKey}`
                      : "no search run yet"
                  }
                  tone={pipeline.candidates.total > 0 ? "brand" : "neutral"}
                  testId="stat-apollo-candidates"
                />
                <StatCard
                  icon={Link2}
                  label="Strong rooftop matches"
                  value={pipeline.candidates.strongMatch.toLocaleString()}
                  sub={
                    pipeline.candidates.total > 0
                      ? `${pct(pipeline.candidates.strongMatch, pipeline.candidates.total)} — the only ones enrichment will pay for`
                      : "nothing matched yet"
                  }
                  tone={pipeline.candidates.strongMatch > 0 ? "success" : "neutral"}
                  testId="stat-apollo-strong-match"
                />
                <StatCard
                  icon={AlertTriangle}
                  label="Unresolved candidates"
                  value={pipeline.candidates.unresolved.toLocaleString()}
                  sub="no rooftop link — not enrichable"
                  tone={pipeline.candidates.unresolved > 0 ? "warning" : "success"}
                  testId="stat-apollo-unresolved"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-2 mt-4">
                <StatCard
                  icon={Power}
                  label="Enrichment (paid reveal)"
                  value={pipeline.enrichmentEnabled ? "Enabled" : "Off"}
                  sub={
                    pipeline.enrichmentEnabled
                      ? "execute runs may spend credits"
                      : "owner-gated; preview only"
                  }
                  tone={pipeline.enrichmentEnabled ? "success" : "neutral"}
                  testId="stat-apollo-enrichment-enabled"
                />
                <StatCard
                  icon={Coins}
                  label="Enrichment runs"
                  value={pipeline.enrichment.runs.toLocaleString()}
                  sub={`${pipeline.enrichment.creditsSpentAllRuns.toLocaleString()} credit${pipeline.enrichment.creditsSpentAllRuns === 1 ? "" : "s"} spent across all runs`}
                  tone="neutral"
                  testId="stat-apollo-enrichment-runs"
                />
                <StatCard
                  icon={Sparkles}
                  label="Contacts from People Search"
                  value={pipeline.enrichment.contactsFromApolloPeople.toLocaleString()}
                  sub="profiles carrying an Apollo person id"
                  tone={pipeline.enrichment.contactsFromApolloPeople > 0 ? "success" : "neutral"}
                  testId="stat-apollo-people-contacts"
                />
                <StatCard
                  icon={MailCheck}
                  label="Last enrichment run"
                  value={pipeline.enrichment.lastRun?.status ?? "None"}
                  sub={
                    pipeline.enrichment.lastRun
                      ? `${pipeline.enrichment.lastRun.mode} · ${pipeline.enrichment.lastRun.creditsSpent.toLocaleString()} credit(s) · ${pipeline.enrichment.lastRun.enrichedCount.toLocaleString()} enriched`
                      : "never run"
                  }
                  tone={
                    pipeline.enrichment.lastRun?.status === "COMPLETED"
                      ? "success"
                      : pipeline.enrichment.lastRun
                        ? "warning"
                        : "neutral"
                  }
                  testId="stat-apollo-last-run"
                />
              </div>
              {pipeline.enrichment.lastRun?.abortReason && (
                <p className="text-xs text-amber-700 mb-2" data-testid="apollo-last-run-abort">
                  Last run stopped early: {pipeline.enrichment.lastRun.abortReason}
                </p>
              )}
              {pipeline.waterfallEnabled && (
                <p className="text-xs text-amber-700 mb-2" data-testid="apollo-waterfall-warning">
                  APOLLO_WATERFALL_ENABLED is set. The wired reveal is the standard
                  single-credit match, so enrichment refuses to execute while this flag is on.
                </p>
              )}
              <p className="text-xs text-slate-500 mb-8">
                Searching is free and never draws a credit. Only an explicit{" "}
                <code className="text-[11px]">mode=execute</code> enrichment run with an explicit
                credit cap can spend, and only while enrichment is enabled.
              </p>
            </>
          )}

          <p className="text-xs text-slate-500">
            Counted {coverage.generatedAt.toISOString()}.
          </p>
        </>
      )}
    </div>
  );
}
