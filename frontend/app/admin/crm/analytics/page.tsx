import {
  Filter,
  Send,
  Zap,
  Store,
  UserPlus,
  DollarSign,
  ShieldAlert,
  AlertTriangle,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import Link from 'next/link';
import { getServiceSupabase } from '@/lib/supabase-service';
import { AnalyticsService } from '@/lib/services/analytics.service';
import { AnalyticsTabs, type AnalyticsTabKey } from '@/components/admin/crm/AnalyticsTabs';
import { EmptyState, KpiCard, PageHeader } from '@/components/admin/crm/ui';
import { formatCents, formatNumber } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const TABS: { key: AnalyticsTabKey; label: string; icon: typeof Filter }[] = [
  { key: 'funnel',      label: 'Funnel',      icon: Filter },
  { key: 'campaigns',   label: 'Campaigns',   icon: Send },
  { key: 'automations', label: 'Automations', icon: Zap },
  { key: 'dealers',     label: 'Dealers',     icon: Store },
  { key: 'affiliates',  label: 'Affiliates',  icon: UserPlus },
  { key: 'revenue',     label: 'Revenue',     icon: DollarSign },
  { key: 'reputation',  label: 'Reputation',  icon: ShieldAlert },
];

// Shared token-styled table/section primitives (mirrors the operations screen).
const SECTION_CLASS =
  'overflow-hidden rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)]';
const CARD_CLASS =
  'rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] p-5';
const TH_BASE =
  'border-b border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-secondary)] px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--crm-text-tertiary)]';
const TD_BASE = 'px-4 py-2.5 align-middle text-[13px] text-[var(--crm-text-secondary)]';

function resolveTab(raw: string | string[] | undefined): AnalyticsTabKey {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (
    v === 'campaigns' || v === 'automations' || v === 'dealers' ||
    v === 'affiliates' || v === 'revenue' || v === 'reputation'
  ) return v;
  return 'funnel';
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active = resolveTab(tab);
  const analytics = new AnalyticsService(getServiceSupabase());

  return (
    <div className="space-y-6 p-6" data-testid="crm-analytics">
      <PageHeader
        title="Analytics"
        subtitle="Lifecycle funnel, campaign performance, automations, and revenue across the platform."
        data-testid="crm-analytics-header"
      />

      <AnalyticsTabs tabs={TABS} active={active} />

      {active === 'funnel'      && <FunnelTab     analytics={analytics} />}
      {active === 'campaigns'   && <CampaignsTab  analytics={analytics} />}
      {active === 'automations' && <AutomationsTab analytics={analytics} />}
      {active === 'dealers'     && <DealersTab    analytics={analytics} />}
      {active === 'affiliates'  && <AffiliatesTab analytics={analytics} />}
      {active === 'revenue'     && <RevenueTab    analytics={analytics} />}
      {active === 'reputation'  && <ReputationTab analytics={analytics} />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// FUNNEL
// ──────────────────────────────────────────────────────────────────────────
async function FunnelTab({ analytics }: { analytics: AnalyticsService }) {
  let funnel;
  try {
    funnel = await analytics.getFunnel();
  } catch (err) {
    return <TabError section="Funnel" error={err} />;
  }
  const maxCount = Math.max(1, ...funnel.stages.map((s) => s.count));

  return (
    <div className="grid gap-5 lg:grid-cols-3" data-testid="crm-analytics-funnel">
      <section className={`lg:col-span-2 ${CARD_CLASS}`}>
        <h2 className="mb-4 text-[13px] font-medium text-[var(--crm-text-primary)]">Stage distribution</h2>
        {funnel.stages.every((s) => s.count === 0) ? (
          <EmptyState
            icon={Filter}
            title="No funnel data yet"
            description="Contacts will populate stages as the lifecycle progresses."
          />
        ) : (
          <div className="overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className={`${TH_BASE} text-left`}>Stage</th>
                  <th className={`${TH_BASE} w-20 text-right`}>Reached</th>
                  <th className={`${TH_BASE} w-20 text-right`}>% of Leads</th>
                  <th className={`${TH_BASE} w-1/3 text-left`}>Bar</th>
                </tr>
              </thead>
              <tbody>
                {funnel.stages.map((s) => (
                  <tr key={s.stage} className="border-b border-[var(--crm-border)] crm-hairline last:border-b-0 hover:bg-[var(--crm-bg-secondary)]">
                    <td className={TD_BASE}>{s.label}</td>
                    <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-text-primary)]`}>
                      {formatNumber(s.count)}
                    </td>
                    <td className={`${TD_BASE} text-right tabular-nums`}>
                      {s.pct_of_leads.toFixed(1)}%
                    </td>
                    <td className={TD_BASE}>
                      <div className="h-4 overflow-hidden rounded-[var(--crm-radius-sm)] bg-[var(--crm-bg-tertiary)]">
                        <div
                          className="h-full bg-[var(--crm-primary)] transition-all"
                          style={{ width: `${(s.count / maxCount) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={CARD_CLASS}>
        <h2 className="mb-4 text-[13px] font-medium text-[var(--crm-text-primary)]">Stage-to-stage conversion</h2>
        {funnel.conversions.every((c) => c.from_count === 0) ? (
          <EmptyState
            icon={TrendingUp}
            title="No conversions yet"
            description="Move a contact between stages to see rates here."
          />
        ) : (
          <ul className="space-y-3">
            {funnel.conversions.map((c) => (
              <li key={`${c.from_stage}->${c.to_stage}`}>
                <div className="flex items-baseline justify-between text-[12px]">
                  <span className="text-[var(--crm-text-tertiary)]">
                    {labelize(c.from_stage)} → {labelize(c.to_stage)}
                  </span>
                  <span className="tabular-nums text-[var(--crm-text-primary)]">
                    {c.conversion_pct.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--crm-bg-tertiary)]">
                  <div
                    className="h-full bg-[var(--crm-success)]"
                    style={{ width: `${Math.min(100, c.conversion_pct)}%` }}
                  />
                </div>
                <div className="mt-0.5 text-[10px] tabular-nums text-[var(--crm-text-tertiary)]">
                  {formatNumber(c.to_count)} of {formatNumber(c.from_count)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// CAMPAIGNS
// ──────────────────────────────────────────────────────────────────────────
async function CampaignsTab({ analytics }: { analytics: AnalyticsService }) {
  let rows;
  try {
    rows = await analytics.getCampaignMetrics();
  } catch (err) {
    return <TabError section="Campaigns" error={err} />;
  }

  return (
    <section className={SECTION_CLASS} data-testid="crm-analytics-campaigns">
      <header className="border-b border-[var(--crm-border)] crm-hairline px-5 py-4">
        <h2 className="text-[13px] font-medium text-[var(--crm-text-primary)]">Campaign performance</h2>
        <p className="mt-0.5 text-[12px] text-[var(--crm-text-tertiary)]">
          Bounce {'>'} 2% flagged warning · {'>'} 5% flagged critical.
        </p>
      </header>
      {rows.length === 0 ? (
        <div className="p-8">
          <EmptyState
            icon={Send}
            title="No campaigns sent yet"
            description="Launch a campaign from /admin/crm/campaigns to populate this view."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className={`${TH_BASE} text-left`}>Name</th>
                <th className={`${TH_BASE} text-left`}>Type</th>
                <th className={`${TH_BASE} text-right`}>Sent</th>
                <th className={`${TH_BASE} text-right`}>Delivered</th>
                <th className={`${TH_BASE} text-right`}>Open</th>
                <th className={`${TH_BASE} text-right`}>Click</th>
                <th className={`${TH_BASE} text-right`}>Bounce</th>
                <th className={`${TH_BASE} text-right`}>Unsub</th>
                <th className={`${TH_BASE} text-center`}>Health</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--crm-border)] crm-hairline last:border-b-0 hover:bg-[var(--crm-bg-secondary)]">
                  <td className={TD_BASE}>
                    <Link
                      href={`/admin/crm/campaigns/${r.id}`}
                      className="text-[var(--crm-text-primary)] hover:text-[var(--crm-primary)]"
                    >
                      {r.name}
                    </Link>
                    {r.sent_at && (
                      <div className="text-[11px] text-[var(--crm-text-tertiary)]">{relativeTime(r.sent_at)}</div>
                    )}
                  </td>
                  <td className={`${TD_BASE} capitalize`}>{r.type}</td>
                  <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-text-primary)]`}>
                    {formatNumber(r.sent_count)}
                  </td>
                  <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-text-tertiary)]`}>
                    {formatNumber(r.delivered_count)}
                  </td>
                  <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-text-tertiary)]`}>
                    {r.open_rate.toFixed(1)}%
                  </td>
                  <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-text-tertiary)]`}>
                    {r.click_rate.toFixed(1)}%
                  </td>
                  <td
                    className={`${TD_BASE} text-right tabular-nums ${
                      r.health === 'critical'
                        ? 'text-[var(--crm-danger)]'
                        : r.health === 'warning'
                          ? 'text-[var(--crm-warning)]'
                          : 'text-[var(--crm-text-tertiary)]'
                    }`}
                  >
                    {r.bounce_rate.toFixed(1)}%
                  </td>
                  <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-text-tertiary)]`}>
                    {r.unsubscribe_rate.toFixed(1)}%
                  </td>
                  <td className={`${TD_BASE} text-center`}>
                    <HealthDot status={r.health} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// AUTOMATIONS
// ──────────────────────────────────────────────────────────────────────────
async function AutomationsTab({ analytics }: { analytics: AnalyticsService }) {
  let rows;
  try {
    rows = await analytics.getAutomationMetrics();
  } catch (err) {
    return <TabError section="Automations" error={err} />;
  }
  return (
    <section className={SECTION_CLASS} data-testid="crm-analytics-automations">
      <header className="border-b border-[var(--crm-border)] crm-hairline px-5 py-4">
        <h2 className="text-[13px] font-medium text-[var(--crm-text-primary)]">Workflow outcomes</h2>
      </header>
      {rows.length === 0 ? (
        <div className="p-8">
          <EmptyState
            icon={Zap}
            title="No workflows yet"
            description="Build one from the prebuilt library at /admin/crm/automations."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className={`${TH_BASE} text-left`}>Workflow</th>
                <th className={`${TH_BASE} text-right`}>Enrolled</th>
                <th className={`${TH_BASE} text-right`}>Active</th>
                <th className={`${TH_BASE} text-right`}>Completed</th>
                <th className={`${TH_BASE} text-right`}>Exited / Failed</th>
                <th className={`${TH_BASE} text-right`}>Completion %</th>
                <th className={`${TH_BASE} text-left`}>Top failure node</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--crm-border)] crm-hairline last:border-b-0 hover:bg-[var(--crm-bg-secondary)]">
                  <td className={TD_BASE}>
                    <Link
                      href={`/admin/crm/automations/${r.id}/edit`}
                      className="text-[var(--crm-text-primary)] hover:text-[var(--crm-primary)]"
                    >
                      {r.name}
                    </Link>
                    <div className="text-[11px] capitalize text-[var(--crm-text-tertiary)]">{r.status}</div>
                  </td>
                  <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-text-primary)]`}>
                    {formatNumber(r.enrolled)}
                  </td>
                  <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-primary)]`}>
                    {formatNumber(r.active)}
                  </td>
                  <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-success)]`}>
                    {formatNumber(r.completed)}
                  </td>
                  <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-danger)]`}>
                    {formatNumber(r.exited + r.failed)}
                  </td>
                  <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-text-tertiary)]`}>
                    {r.completion_rate.toFixed(1)}%
                  </td>
                  <td className={TD_BASE}>
                    {r.top_failure_node ? (
                      <span>
                        <code className="text-[11px] text-[var(--crm-warning)]">{r.top_failure_node}</code>
                        <span className="ml-2 text-[11px] text-[var(--crm-text-tertiary)]">
                          ×{r.top_failure_count}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[var(--crm-text-tertiary)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// DEALERS
// ──────────────────────────────────────────────────────────────────────────
async function DealersTab({ analytics }: { analytics: AnalyticsService }) {
  let rows;
  try {
    rows = await analytics.getDealerMetrics();
  } catch (err) {
    return <TabError section="Dealers" error={err} />;
  }
  return (
    <section className={SECTION_CLASS} data-testid="crm-analytics-dealers">
      <header className="border-b border-[var(--crm-border)] crm-hairline px-5 py-4">
        <h2 className="text-[13px] font-medium text-[var(--crm-text-primary)]">Dealer performance</h2>
      </header>
      {rows.length === 0 ? (
        <div className="p-8">
          <EmptyState icon={Store} title="No dealers yet" description="Invite dealers to populate this view." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className={`${TH_BASE} text-left`}>Dealer</th>
                <th className={`${TH_BASE} text-right`}>Offers Submitted</th>
                <th className={`${TH_BASE} text-right`}>Win Rate</th>
                <th className={`${TH_BASE} text-right`}>Avg Response</th>
                <th className={`${TH_BASE} text-right`}>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--crm-border)] crm-hairline last:border-b-0 hover:bg-[var(--crm-bg-secondary)]">
                  <td className={TD_BASE}>
                    <div className="text-[var(--crm-text-primary)]">{r.name}</div>
                    <div className="text-[11px] text-[var(--crm-text-tertiary)]">{r.status}</div>
                  </td>
                  <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-text-primary)]`}>
                    {formatNumber(r.offers_submitted)}
                  </td>
                  <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-success)]`}>
                    {r.win_rate.toFixed(1)}%
                  </td>
                  <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-text-tertiary)]`}>
                    {r.avg_response_hours === null
                      ? '—'
                      : `${r.avg_response_hours.toFixed(1)}h`}
                  </td>
                  <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-text-tertiary)]`}>
                    {relativeTime(r.last_active_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// AFFILIATES
// ──────────────────────────────────────────────────────────────────────────
async function AffiliatesTab({ analytics }: { analytics: AnalyticsService }) {
  let rows;
  try {
    rows = await analytics.getAffiliateMetrics();
  } catch (err) {
    return <TabError section="Affiliates" error={err} />;
  }
  return (
    <section className={SECTION_CLASS} data-testid="crm-analytics-affiliates">
      <header className="border-b border-[var(--crm-border)] crm-hairline px-5 py-4">
        <h2 className="text-[13px] font-medium text-[var(--crm-text-primary)]">Affiliate performance</h2>
      </header>
      {rows.length === 0 ? (
        <div className="p-8">
          <EmptyState
            icon={UserPlus}
            title="No affiliates yet"
            description="Approve an affiliate signup to populate this view."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className={`${TH_BASE} text-left`}>Affiliate</th>
                <th className={`${TH_BASE} text-left`}>Code</th>
                <th className={`${TH_BASE} text-right`}>Sent</th>
                <th className={`${TH_BASE} text-right`}>Converted</th>
                <th className={`${TH_BASE} text-right`}>Conversion</th>
                <th className={`${TH_BASE} text-right`}>Commission</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--crm-border)] crm-hairline last:border-b-0 hover:bg-[var(--crm-bg-secondary)]">
                  <td className={`${TD_BASE} text-[var(--crm-text-primary)]`}>{r.id.slice(0, 8)}…</td>
                  <td className={TD_BASE}>
                    <code className="text-[11px]">{r.referral_code}</code>
                  </td>
                  <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-text-primary)]`}>
                    {formatNumber(r.referrals_sent)}
                  </td>
                  <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-success)]`}>
                    {formatNumber(r.referrals_converted)}
                  </td>
                  <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-text-tertiary)]`}>
                    {r.conversion_rate.toFixed(1)}%
                  </td>
                  <td className={`${TD_BASE} text-right tabular-nums text-[var(--crm-success)]`}>
                    {formatCents(r.commission_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// REVENUE
// ──────────────────────────────────────────────────────────────────────────
async function RevenueTab({ analytics }: { analytics: AnalyticsService }) {
  let r;
  try {
    r = await analytics.getRevenueMetrics();
  } catch (err) {
    return <TabError section="Revenue" error={err} />;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="crm-analytics-revenue">
      <KpiCard
        label="Deposits collected"
        value={formatCents(r.deposits_collected_cents)}
        sublabel={`${formatNumber(r.deposits_count)} deposits`}
        icon={DollarSign}
      />
      <KpiCard
        label="Purchase volume"
        value={formatCents(r.purchase_volume_cents)}
        sublabel={`${formatNumber(r.purchases_count)} deals`}
        icon={TrendingUp}
      />
      <KpiCard
        label="Refunds issued"
        value={formatCents(r.refunds_cents)}
        sublabel={`${formatNumber(r.refunds_count)} refunds`}
        icon={AlertTriangle}
      />
      <KpiCard
        label="Net revenue"
        value={formatCents(r.net_revenue_cents)}
        sublabel="Deposits + fees − refunds"
        icon={DollarSign}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// REPUTATION
// ──────────────────────────────────────────────────────────────────────────
async function ReputationTab({ analytics }: { analytics: AnalyticsService }) {
  let r;
  try {
    r = await analytics.getReputationMetrics();
  } catch (err) {
    return <TabError section="Reputation" error={err} />;
  }
  const banner =
    r.reputation_status === 'critical'
      ? { tone: 'danger', icon: ShieldAlert, text: 'CRITICAL — bounce or complaint rate is past the carrier threshold. Sender reputation at risk.' }
      : r.reputation_status === 'warning'
        ? { tone: 'warning', icon: AlertTriangle, text: 'WARNING — bounce or complaint rate is elevated. Investigate before next bulk send.' }
        : { tone: 'success', icon: CheckCircle2, text: 'Sender reputation healthy.' };
  const BannerIcon = banner.icon;

  return (
    <div className="space-y-5" data-testid="crm-analytics-reputation">
      <div
        className="flex items-center gap-3 rounded-[var(--crm-radius-md)] border px-4 py-3"
        style={{
          color: `var(--crm-${banner.tone})`,
          borderColor: `var(--crm-${banner.tone}-subtle)`,
          backgroundColor: `var(--crm-${banner.tone}-subtle)`,
        }}
        data-testid="crm-analytics-reputation-banner"
      >
        <BannerIcon className="h-5 w-5 shrink-0" />
        <div className="text-[13px] font-medium">{banner.text}</div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Email bounce rate"
          value={`${r.email_bounce_rate.toFixed(2)}%`}
          sublabel={`${formatNumber(r.email_bounced)} of ${formatNumber(r.email_total_sent)}`}
        />
        <KpiCard
          label="Email complaint rate"
          value={`${r.email_complaint_rate.toFixed(3)}%`}
          sublabel={`${formatNumber(r.email_complained)} complaints`}
        />
        <KpiCard
          label="Email unsubscribes"
          value={formatNumber(r.email_unsubscribed)}
          sublabel="Total suppressed"
        />
        <KpiCard
          label="SMS opt-out rate"
          value={`${r.sms_optout_rate.toFixed(2)}%`}
          sublabel={`${formatNumber(r.sms_stopped)} STOP of ${formatNumber(r.sms_total_sent)} sent`}
        />
      </div>

      <section className={CARD_CLASS}>
        <h3 className="mb-3 text-[13px] font-medium text-[var(--crm-text-primary)]">30-day bounce rate trend</h3>
        {r.bounce_trend.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title="No timeline data yet"
            description="Bounce events will plot here once campaigns start sending."
          />
        ) : (
          <div className="flex h-32 items-end gap-1">
            {r.bounce_trend.map((p) => (
              <div key={p.day} className="flex flex-1 flex-col items-center gap-1" title={`${p.day}: ${p.bounce_rate.toFixed(1)}%`}>
                <div
                  className="w-full rounded-t-[var(--crm-radius-sm)]"
                  style={{
                    height: `${Math.max(2, Math.min(100, p.bounce_rate * 5))}%`,
                    backgroundColor:
                      p.bounce_rate >= 5
                        ? 'var(--crm-danger)'
                        : p.bounce_rate >= 2
                          ? 'var(--crm-warning)'
                          : 'var(--crm-primary)',
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// SHARED
// ──────────────────────────────────────────────────────────────────────────
function HealthDot({ status }: { status: 'ok' | 'warning' | 'critical' }) {
  const color =
    status === 'critical'
      ? 'var(--crm-danger)'
      : status === 'warning'
        ? 'var(--crm-warning)'
        : 'var(--crm-success)';
  return <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />;
}

// Per-tab fallback. Keeps the rest of the analytics page renderable when a
// single section's query fails (matview missing, RLS, dependent table empty),
// rather than crashing the whole route.
function TabError({ section, error }: { section: string; error: unknown }) {
  if (process.env.NODE_ENV !== 'production') {
    // Surface the cause in dev so the source of the failure is obvious.
    // eslint-disable-next-line no-console
    console.error(`[analytics:${section}]`, error);
  }
  const message =
    error instanceof Error ? error.message : 'Unknown error fetching analytics.';
  return (
    <section className="rounded-[var(--crm-radius-md)] border border-[var(--crm-danger-subtle)] bg-[var(--crm-bg-primary)] p-5">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--crm-danger)]" />
        <div>
          <h2 className="text-[13px] font-medium text-[var(--crm-text-primary)]">
            {section} analytics unavailable
          </h2>
          <p className="mt-1 text-[12px] text-[var(--crm-text-tertiary)]">
            We couldn&rsquo;t load this section. Other tabs may still work. Try
            refreshing in a moment.
          </p>
          <p className="mt-2 break-all font-mono text-[11px] text-[var(--crm-danger)]">{message}</p>
        </div>
      </div>
    </section>
  );
}

const LABEL_MAP: Record<string, string> = {
  lead: 'Lead',
  prequal_started: 'Prequal',
  prequal_completed: 'Prequal Done',
  deposit_pending: 'Deposit Pend.',
  deposit_paid: 'Deposit Paid',
  auction_active: 'Auction',
  offer_received: 'Offer',
  purchase_completed: 'Purchased',
};
function labelize(stage: string): string {
  return LABEL_MAP[stage] ?? stage;
}
