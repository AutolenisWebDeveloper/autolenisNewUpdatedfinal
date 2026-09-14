// Admin — financing follow-up queue. Lists open §26 financing exceptions and lets an operational
// admin resolve each. Reads server-side; the resolve mutation goes through the role-guarded,
// audited API. No buyer PII is shown here — rows carry ids, the required action, and a deadline.
//
// RE-POINTED IN PHASE 7 (§13-D25), NOT RETIRED. This page used to list `financing_review_tasks`:
// stips, adverse-action declines, edge declines and lender failures, all of them states of the
// in-house lender decisioning §12 says AutoLenis never performs. Its only producer
// (`financing-orchestrator.service.ts`) had zero production callers and is deleted in this phase,
// so the queue could only ever have been empty.
//
// The capability an operator actually has is unchanged: see what needs a human decision, and
// resolve it with a recorded note. It now reads `queue_items` — one queue, §26's register — where
// the rows are produced by `recordFinancingCheckpoint`'s FAILED/EXPIRED branch, which runs.
import { listOpenFinancingFollowUps } from "@/lib/services/financing/financing-follow-up.service";
import { Badge, EmptyState, PageHeader } from "@/components/admin/crm/ui";
import { ClipboardCheck } from "lucide-react";
import { ResolveReviewControl } from "@/components/admin/financing/ResolveReviewControl";

export const dynamic = "force-dynamic";

function relTime(d: Date): string {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function FinancingReviewsPage() {
  // Deliberately NOT wrapped in try/catch. A query failure renders as a failure (Next's error
  // boundary), never as "no open follow-ups" — an admin shown a confident empty because the
  // database was unreachable would close the tab.
  const followUps = await listOpenFinancingFollowUps(200);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Financing follow-ups"
        subtitle="Deals whose financing failed or expired. Each returns the buyer to another external path — never an automatic cancellation."
      />

      <section className="overflow-hidden rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)]">
        <header className="flex items-center justify-between border-b border-[var(--crm-border)] crm-hairline px-5 py-4">
          <h2 className="text-[13px] font-medium text-[var(--crm-text-primary)]">Open follow-ups</h2>
          <span className="text-[12px] text-[var(--crm-text-tertiary)]">{followUps.length} open</span>
        </header>

        {followUps.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No open financing follow-ups"
            description="A deal whose financing fails or expires appears here with the path to try next."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="border-b border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-secondary)] px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--crm-text-tertiary)]">Exception</th>
                  <th className="border-b border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-secondary)] px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--crm-text-tertiary)]">Deal</th>
                  <th className="border-b border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-secondary)] px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--crm-text-tertiary)]">Required action</th>
                  <th className="border-b border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-secondary)] px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--crm-text-tertiary)]">Age</th>
                  <th className="border-b border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-secondary)] px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-[var(--crm-text-tertiary)]">Resolve</th>
                </tr>
              </thead>
              <tbody>
                {followUps.map((f) => (
                  <tr key={f.id} className="border-b border-[var(--crm-border)] crm-hairline last:border-b-0">
                    <td className="px-4 py-3 align-top">
                      <Badge tone="warning" size="sm">
                        {(f.exceptionCode ?? "FINANCING").replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <code className="text-[12px] text-[var(--crm-primary)]">{(f.dealId ?? "—").slice(0, 8)}</code>
                    </td>
                    <td className="px-4 py-3 align-top text-[13px] text-[var(--crm-text-secondary)]">
                      {f.requiredAction ?? "—"}
                    </td>
                    <td className="px-4 py-3 align-top text-[12px] tabular-nums text-[var(--crm-text-tertiary)]">
                      {relTime(f.createdAt)}
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <ResolveReviewControl taskId={f.id} taskType={f.exceptionCode ?? "FINANCING_FOLLOW_UP"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
