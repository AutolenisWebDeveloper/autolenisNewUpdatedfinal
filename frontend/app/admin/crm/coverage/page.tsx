// app/admin/crm/coverage/page.tsx
// PHASE F — No Lead Left Behind coverage dashboard. Surfaces the "uncovered"
// KPI (the forbidden 4th state) and the 4-state breakdown, driven toward ~0 by
// the daily reconcile sweep (/api/crm/reconcile/run).

import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Users,
  Send,
  RotateCcw,
  ShieldOff,
  AlertCircle,
} from 'lucide-react';
import { getServiceSupabase } from '@/lib/supabase-service';
import { getCoverageSummary, DEFAULT_STALE_DAYS, type CoverageSummary } from '@/lib/crm/coverage';
import { KpiCard, PageHeader } from '@/components/admin/crm/ui';
import { formatNumber } from '@/lib/utils';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const CARD_CLASS =
  'rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] p-5';
const TH_BASE =
  'border-b border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-secondary)] px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--crm-text-tertiary)]';
const TD_BASE = 'px-4 py-2.5 align-middle text-[13px] text-[var(--crm-text-secondary)]';

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function resolveStaleDays(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STALE_DAYS;
}

export default async function CoveragePage({
  searchParams,
}: {
  searchParams: Promise<{ stale_days?: string }>;
}) {
  const { stale_days } = await searchParams;
  const staleDays = resolveStaleDays(stale_days);

  let summary: CoverageSummary;
  try {
    summary = await getCoverageSummary(getServiceSupabase(), { staleDays });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') logger.error('[crm:coverage]', err);
    return (
      <div className="space-y-6 p-6" data-testid="crm-coverage">
        <PageHeader
          title="Coverage"
          subtitle="No Lead Left Behind — uncovered contacts that need re-engagement."
        />
        <section className="rounded-[var(--crm-radius-md)] border border-[var(--crm-danger-subtle)] bg-[var(--crm-bg-primary)] p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--crm-danger)]" />
            <div>
              <h2 className="text-[13px] font-medium text-[var(--crm-text-primary)]">
                Coverage unavailable
              </h2>
              <p className="mt-1 text-[12px] text-[var(--crm-text-tertiary)]">
                Couldn&rsquo;t compute coverage. The <code>nurture_status</code> /{' '}
                <code>last_contacted_at</code> columns (migration 13) must be applied.
              </p>
              <p className="mt-2 break-all font-mono text-[11px] text-[var(--crm-danger)]">
                {err instanceof Error ? err.message : 'Unknown error'}
              </p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const banner =
    summary.status === 'critical'
      ? {
          tone: 'danger',
          icon: ShieldAlert,
          text: `CRITICAL — ${formatNumber(summary.uncovered)} contactable leads (${pct(
            summary.uncoveredRate,
          )}) are uncovered: not in a campaign, not in re-engagement, and stale. Run the reconcile sweep.`,
        }
      : summary.status === 'attention'
        ? {
            tone: 'warning',
            icon: AlertTriangle,
            text: `ATTENTION — ${formatNumber(
              summary.uncovered,
            )} uncovered leads (${pct(summary.uncoveredRate)}). The daily reconcile sweep should drain these.`,
          }
        : {
            tone: 'success',
            icon: CheckCircle2,
            text: 'Clear — every contactable lead is in an active campaign, being re-engaged, or recently contacted. No leads left behind.',
          };
  const BannerIcon = banner.icon;

  // Clean partition of the CONTACTABLE set (do_not_contact = false):
  // active + reengagement + suppressedStatus + graceNone + uncovered = contactable.
  // do_not_contact is the separate hard-suppressed plane, shown below the table.
  const states = [
    {
      label: 'Active Campaign',
      value: summary.active,
      icon: Send,
      tone: 'var(--crm-success)',
      note: 'Currently enrolled',
    },
    {
      label: 'Re-Engagement',
      value: summary.reengagement,
      icon: RotateCcw,
      tone: 'var(--crm-primary)',
      note: 'Being reactivated',
    },
    {
      label: 'Suppressed',
      value: summary.suppressedStatus,
      icon: ShieldOff,
      tone: 'var(--crm-text-tertiary)',
      note: 'Explicitly held out (nurture_status)',
    },
    {
      label: 'Recently contacted',
      value: summary.graceNone,
      icon: CheckCircle2,
      tone: 'var(--crm-text-tertiary)',
      note: `Contacted within ${summary.staleDays}d — grace window`,
    },
    {
      label: 'Uncovered',
      value: summary.uncovered,
      icon: ShieldAlert,
      tone: summary.uncovered > 0 ? 'var(--crm-danger)' : 'var(--crm-success)',
      note: 'Forbidden 4th state → target 0',
    },
  ];

  return (
    <div className="space-y-6 p-6" data-testid="crm-coverage">
      <PageHeader
        title="Coverage"
        subtitle={`No Lead Left Behind — a lead is "uncovered" if it is contactable but not in a campaign, not being re-engaged, and not contacted in the last ${summary.staleDays} days.`}
        data-testid="crm-coverage-header"
      />

      <div
        className="flex items-center gap-3 rounded-[var(--crm-radius-md)] border px-4 py-3"
        style={{
          color: `var(--crm-${banner.tone})`,
          borderColor: `var(--crm-${banner.tone}-subtle)`,
          backgroundColor: `var(--crm-${banner.tone}-subtle)`,
        }}
        data-testid="crm-coverage-banner"
      >
        <BannerIcon className="h-5 w-5 shrink-0" />
        <div className="text-[13px] font-medium">{banner.text}</div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="crm-coverage-kpis">
        <KpiCard
          label="Uncovered (NLLB)"
          value={formatNumber(summary.uncovered)}
          sublabel={`${pct(summary.uncoveredRate)} of contactable · target ~0`}
          icon={ShieldAlert}
          trust
          data-testid="crm-coverage-kpi-uncovered"
        />
        <KpiCard
          label="Coverage rate"
          value={pct(summary.coverageRate)}
          sublabel={`${formatNumber(summary.covered)} active or re-engaging`}
          icon={ShieldCheck}
        />
        <KpiCard
          label="Contactable"
          value={formatNumber(summary.contactable)}
          sublabel={`${formatNumber(summary.totalLive)} total · ${formatNumber(
            summary.doNotContact,
          )} do-not-contact`}
          icon={Users}
        />
        <KpiCard
          label="In grace window"
          value={formatNumber(summary.graceNone)}
          sublabel={`Uncontacted but < ${summary.staleDays}d old`}
          icon={CheckCircle2}
        />
      </div>

      <section className={CARD_CLASS} data-testid="crm-coverage-breakdown">
        <h2 className="mb-1 text-[13px] font-medium text-[var(--crm-text-primary)]">
          Lifecycle coverage states
        </h2>
        <p className="mb-4 text-[12px] text-[var(--crm-text-tertiary)]">
          Every contactable contact must be in exactly one state. Drive{' '}
          <strong>Uncovered</strong> to zero via the daily reconcile sweep.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className={`${TH_BASE} text-left`}>State</th>
                <th className={`${TH_BASE} text-right`}>Contacts</th>
                <th className={`${TH_BASE} text-right`}>% of contactable</th>
                <th className={`${TH_BASE} text-left`}>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {states.map((s) => {
                const Icon = s.icon;
                const share = summary.contactable > 0 ? s.value / summary.contactable : 0;
                return (
                  <tr
                    key={s.label}
                    className="border-b border-[var(--crm-border)] crm-hairline last:border-b-0 hover:bg-[var(--crm-bg-secondary)]"
                  >
                    <td className={TD_BASE}>
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4" style={{ color: s.tone }} strokeWidth={1.75} />
                        <span className="text-[var(--crm-text-primary)]">{s.label}</span>
                      </span>
                    </td>
                    <td
                      className="px-4 py-2.5 text-right align-middle text-[13px] tabular-nums"
                      style={{ color: s.tone }}
                    >
                      {formatNumber(s.value)}
                    </td>
                    <td className={`${TD_BASE} text-right tabular-nums`}>{pct(share)}</td>
                    <td className={`${TD_BASE}`}>{s.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
