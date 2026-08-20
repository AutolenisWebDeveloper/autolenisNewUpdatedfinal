// Admin — financing human-in-the-loop review queue. Lists open review tasks (stips,
// adverse-action, edge declines, lender failures) and lets an operational admin
// resolve each. Reads server-side; the resolve mutation goes through the
// role-guarded, audited API. No PII is shown here (tasks carry only ids + reason).
import { listOpenReviewTasks } from "@/lib/services/financing/review-queue.service";
import { Badge, EmptyState, PageHeader, type Tone } from "@/components/admin/crm/ui";
import { ClipboardCheck } from "lucide-react";
import { ResolveReviewControl } from "@/components/admin/financing/ResolveReviewControl";

export const dynamic = "force-dynamic";

const TASK_TONE: Record<string, Tone> = {
  ADVERSE_ACTION_REVIEW: "danger",
  LENDER_FAILURE_REVIEW: "warning",
  STIP_REVIEW: "info",
  EDGE_DECLINE_REVIEW: "warning",
  MANUAL_DECISION_REVIEW: "info",
};

function relTime(d: Date): string {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function FinancingReviewsPage() {
  const tasks = await listOpenReviewTasks(200);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Financing reviews"
        subtitle="Human-in-the-loop queue for stipulations, adverse-action declines, and lender exceptions."
      />

      <section className="overflow-hidden rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)]">
        <header className="flex items-center justify-between border-b border-[var(--crm-border)] crm-hairline px-5 py-4">
          <h2 className="text-[13px] font-medium text-[var(--crm-text-primary)]">Open tasks</h2>
          <span className="text-[12px] text-[var(--crm-text-tertiary)]">
            {tasks.length} open
          </span>
        </header>

        {tasks.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No open financing reviews"
            description="Applications needing a human decision will appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="border-b border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-secondary)] px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--crm-text-tertiary)]">Type</th>
                  <th className="border-b border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-secondary)] px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--crm-text-tertiary)]">Application</th>
                  <th className="border-b border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-secondary)] px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--crm-text-tertiary)]">Reason</th>
                  <th className="border-b border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-secondary)] px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--crm-text-tertiary)]">Age</th>
                  <th className="border-b border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-secondary)] px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-[var(--crm-text-tertiary)]">Resolve</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} className="border-b border-[var(--crm-border)] crm-hairline last:border-b-0">
                    <td className="px-4 py-3 align-top">
                      <Badge tone={TASK_TONE[t.taskType] ?? "info"} size="sm">
                        {t.taskType.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <code className="text-[12px] text-[var(--crm-primary)]">{t.creditApplicationId.slice(0, 8)}</code>
                    </td>
                    <td className="px-4 py-3 align-top text-[13px] text-[var(--crm-text-secondary)]">{t.reason ?? "—"}</td>
                    <td className="px-4 py-3 align-top text-[12px] tabular-nums text-[var(--crm-text-tertiary)]">{relTime(t.createdAt)}</td>
                    <td className="px-4 py-3 align-top text-right">
                      <ResolveReviewControl taskId={t.id} taskType={t.taskType} />
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
