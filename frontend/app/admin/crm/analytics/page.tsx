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
} from 'lucide-react';
import Link from 'next/link';
import { getServiceSupabase } from '@/lib/supabase-service';
import { AnalyticsService } from '@/lib/services/analytics.service';
import { AnalyticsTabs, type AnalyticsTabKey } from '@/components/admin/crm/AnalyticsTabs';
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
    <div className="p-6 space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">
            Lifecycle funnel, campaign performance, automations, and revenue across the platform.
          </p>
        </div>
      </header>

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
  const funnel = await analytics.getFunnel();
  const maxCount = Math.max(1, ...funnel.stages.map((s) => s.count));

  return (
    <div className="grid lg:grid-cols-3 gap-5">
      <section className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Stage Distribution</h2>
        {funnel.stages.every((s) => s.count === 0) ? (
          <EmptyState
            icon={Filter}
            title="No funnel data yet"
            subtitle="Contacts will populate stages as the lifecycle progresses."
          />
        ) : (
          <div className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="text-left py-2 px-2">Stage</th>
                  <th className="text-right py-2 px-2 w-20">Reached</th>
                  <th className="text-right py-2 px-2 w-20">% of Leads</th>
                  <th className="py-2 px-2 w-1/3">Bar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {funnel.stages.map((s) => (
                  <tr key={s.stage} className="hover:bg-gray-800/30">
                    <td className="py-2 px-2 text-gray-300">{s.label}</td>
                    <td className="py-2 px-2 text-right text-white tabular-nums">
                      {formatNumber(s.count)}
                    </td>
                    <td className="py-2 px-2 text-right text-gray-400 tabular-nums">
                      {s.pct_of_leads.toFixed(1)}%
                    </td>
                    <td className="py-2 px-2">
                      <div className="h-4 bg-gray-950 rounded overflow-hidden">
                        <div
                          className="h-full bg-blue-600 transition-all"
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

      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Stage-to-Stage Conversion</h2>
        {funnel.conversions.every((c) => c.from_count === 0) ? (
          <EmptyState
            icon={TrendingUp}
            title="No conversions yet"
            subtitle="Move a contact between stages to see rates here."
          />
        ) : (
          <ul className="space-y-3">
            {funnel.conversions.map((c) => (
              <li key={`${c.from_stage}->${c.to_stage}`}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-gray-400">
                    {labelize(c.from_stage)} → {labelize(c.to_stage)}
                  </span>
                  <span className="text-white tabular-nums">
                    {c.conversion_pct.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 bg-gray-950 rounded overflow-hidden">
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${Math.min(100, c.conversion_pct)}%` }}
                  />
                </div>
                <div className="text-[10px] text-gray-600 mt-0.5 tabular-nums">
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
  const rows = await analytics.getCampaignMetrics();

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <header className="px-5 py-4 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-white">Campaign Performance</h2>
        <p className="text-[11px] text-gray-500 mt-0.5">
          Bounce {'>'} 2% flagged warning · {'>'} 5% flagged critical.
        </p>
      </header>
      {rows.length === 0 ? (
        <div className="p-8">
          <EmptyState
            icon={Send}
            title="No campaigns sent yet"
            subtitle="Launch a campaign from /admin/crm/campaigns to populate this view."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-950/30">
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Type</th>
                <th className="text-right px-4 py-2">Sent</th>
                <th className="text-right px-4 py-2">Delivered</th>
                <th className="text-right px-4 py-2">Open</th>
                <th className="text-right px-4 py-2">Click</th>
                <th className="text-right px-4 py-2">Bounce</th>
                <th className="text-right px-4 py-2">Unsub</th>
                <th className="text-center px-4 py-2">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-800/30">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/crm/campaigns/${r.id}`}
                      className="text-white hover:text-blue-300"
                    >
                      {r.name}
                    </Link>
                    {r.sent_at && (
                      <div className="text-[11px] text-gray-600">{relativeTime(r.sent_at)}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 capitalize">{r.type}</td>
                  <td className="px-4 py-2.5 text-right text-white tabular-nums">
                    {formatNumber(r.sent_count)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-300 tabular-nums">
                    {formatNumber(r.delivered_count)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-300 tabular-nums">
                    {r.open_rate.toFixed(1)}%
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-300 tabular-nums">
                    {r.click_rate.toFixed(1)}%
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right tabular-nums ${
                      r.health === 'critical'
                        ? 'text-red-400'
                        : r.health === 'warning'
                          ? 'text-yellow-400'
                          : 'text-gray-300'
                    }`}
                  >
                    {r.bounce_rate.toFixed(1)}%
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-300 tabular-nums">
                    {r.unsubscribe_rate.toFixed(1)}%
                  </td>
                  <td className="px-4 py-2.5 text-center">
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
  const rows = await analytics.getAutomationMetrics();
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <header className="px-5 py-4 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-white">Workflow Outcomes</h2>
      </header>
      {rows.length === 0 ? (
        <div className="p-8">
          <EmptyState
            icon={Zap}
            title="No workflows yet"
            subtitle="Build one from the prebuilt library at /admin/crm/automations."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-950/30">
                <th className="text-left px-4 py-2">Workflow</th>
                <th className="text-right px-4 py-2">Enrolled</th>
                <th className="text-right px-4 py-2">Active</th>
                <th className="text-right px-4 py-2">Completed</th>
                <th className="text-right px-4 py-2">Exited / Failed</th>
                <th className="text-right px-4 py-2">Completion %</th>
                <th className="text-left px-4 py-2">Top failure node</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-800/30">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/crm/automations/${r.id}/edit`}
                      className="text-white hover:text-blue-300"
                    >
                      {r.name}
                    </Link>
                    <div className="text-[11px] text-gray-600 capitalize">{r.status}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-white tabular-nums">
                    {formatNumber(r.enrolled)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-blue-300 tabular-nums">
                    {formatNumber(r.active)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-emerald-400 tabular-nums">
                    {formatNumber(r.completed)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-red-400 tabular-nums">
                    {formatNumber(r.exited + r.failed)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-300 tabular-nums">
                    {r.completion_rate.toFixed(1)}%
                  </td>
                  <td className="px-4 py-2.5 text-gray-400">
                    {r.top_failure_node ? (
                      <span>
                        <code className="text-[11px] text-yellow-300">{r.top_failure_node}</code>
                        <span className="text-[11px] text-gray-600 ml-2">
                          ×{r.top_failure_count}
                        </span>
                      </span>
                    ) : (
                      <span className="text-gray-700">—</span>
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
  const rows = await analytics.getDealerMetrics();
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <header className="px-5 py-4 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-white">Dealer Performance</h2>
      </header>
      {rows.length === 0 ? (
        <div className="p-8">
          <EmptyState icon={Store} title="No dealers yet" subtitle="Invite dealers to populate this view." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-950/30">
                <th className="text-left px-4 py-2">Dealer</th>
                <th className="text-right px-4 py-2">Offers Submitted</th>
                <th className="text-right px-4 py-2">Win Rate</th>
                <th className="text-right px-4 py-2">Avg Response</th>
                <th className="text-right px-4 py-2">Last Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-800/30">
                  <td className="px-4 py-2.5">
                    <div className="text-white">{r.name}</div>
                    <div className="text-[11px] text-gray-600">{r.status}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-white tabular-nums">
                    {formatNumber(r.offers_submitted)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-emerald-400 tabular-nums">
                    {r.win_rate.toFixed(1)}%
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-300 tabular-nums">
                    {r.avg_response_hours === null
                      ? '—'
                      : `${r.avg_response_hours.toFixed(1)}h`}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-400 tabular-nums">
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
  const rows = await analytics.getAffiliateMetrics();
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <header className="px-5 py-4 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-white">Affiliate Performance</h2>
      </header>
      {rows.length === 0 ? (
        <div className="p-8">
          <EmptyState
            icon={UserPlus}
            title="No affiliates yet"
            subtitle="Approve an affiliate signup to populate this view."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-950/30">
                <th className="text-left px-4 py-2">Affiliate</th>
                <th className="text-left px-4 py-2">Code</th>
                <th className="text-right px-4 py-2">Sent</th>
                <th className="text-right px-4 py-2">Converted</th>
                <th className="text-right px-4 py-2">Conversion</th>
                <th className="text-right px-4 py-2">Commission</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-800/30">
                  <td className="px-4 py-2.5 text-white">{r.id.slice(0, 8)}…</td>
                  <td className="px-4 py-2.5 text-gray-400">
                    <code className="text-[11px]">{r.referral_code}</code>
                  </td>
                  <td className="px-4 py-2.5 text-right text-white tabular-nums">
                    {formatNumber(r.referrals_sent)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-emerald-400 tabular-nums">
                    {formatNumber(r.referrals_converted)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-300 tabular-nums">
                    {r.conversion_rate.toFixed(1)}%
                  </td>
                  <td className="px-4 py-2.5 text-right text-emerald-300 tabular-nums">
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
  const r = await analytics.getRevenueMetrics();
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <RevenueCard
        label="Deposits Collected"
        value={formatCents(r.deposits_collected_cents)}
        sub={`${formatNumber(r.deposits_count)} deposits`}
        accent="blue"
      />
      <RevenueCard
        label="Purchase Volume"
        value={formatCents(r.purchase_volume_cents)}
        sub={`${formatNumber(r.purchases_count)} deals`}
        accent="emerald"
      />
      <RevenueCard
        label="Refunds Issued"
        value={formatCents(r.refunds_cents)}
        sub={`${formatNumber(r.refunds_count)} refunds`}
        accent="red"
      />
      <RevenueCard
        label="Net Revenue"
        value={formatCents(r.net_revenue_cents)}
        sub="Deposits + fees − refunds"
        accent="emerald"
      />
    </div>
  );
}

function RevenueCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: 'blue' | 'emerald' | 'red';
}) {
  const ring =
    accent === 'blue'
      ? 'border-blue-500/30 bg-blue-500/5'
      : accent === 'emerald'
        ? 'border-emerald-500/30 bg-emerald-500/5'
        : 'border-red-500/30 bg-red-500/5';
  return (
    <div className={`border rounded-xl p-5 ${ring}`}>
      <div className="text-[11px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="mt-2 text-2xl font-bold text-white tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] text-gray-500">{sub}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// REPUTATION
// ──────────────────────────────────────────────────────────────────────────
async function ReputationTab({ analytics }: { analytics: AnalyticsService }) {
  const r = await analytics.getReputationMetrics();
  const banner =
    r.reputation_status === 'critical'
      ? { className: 'bg-red-500/10 border-red-500/30 text-red-300', icon: ShieldAlert, text: 'CRITICAL — bounce or complaint rate is past the carrier threshold. Sender reputation at risk.' }
      : r.reputation_status === 'warning'
        ? { className: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300', icon: AlertTriangle, text: 'WARNING — bounce or complaint rate is elevated. Investigate before next bulk send.' }
        : { className: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300', icon: CheckCircle2, text: 'Sender reputation healthy.' };
  const BannerIcon = banner.icon;

  return (
    <div className="space-y-5">
      <div className={`flex items-center gap-3 border rounded-xl px-4 py-3 ${banner.className}`}>
        <BannerIcon className="w-5 h-5 shrink-0" />
        <div className="text-sm font-semibold">{banner.text}</div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ReputationCard
          label="Email Bounce Rate"
          value={`${r.email_bounce_rate.toFixed(2)}%`}
          warn={r.email_bounce_rate >= 2}
          crit={r.email_bounce_rate >= 5}
          sub={`${formatNumber(r.email_bounced)} of ${formatNumber(r.email_total_sent)}`}
        />
        <ReputationCard
          label="Email Complaint Rate"
          value={`${r.email_complaint_rate.toFixed(3)}%`}
          warn={r.email_complaint_rate >= 0.1}
          crit={r.email_complaint_rate >= 0.3}
          sub={`${formatNumber(r.email_complained)} complaints`}
        />
        <ReputationCard
          label="Email Unsubscribes"
          value={formatNumber(r.email_unsubscribed)}
          sub="Total suppressed"
        />
        <ReputationCard
          label="SMS Opt-Out Rate"
          value={`${r.sms_optout_rate.toFixed(2)}%`}
          sub={`${formatNumber(r.sms_stopped)} STOP of ${formatNumber(r.sms_total_sent)} sent`}
        />
      </div>

      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3">30-Day Bounce Rate Trend</h3>
        {r.bounce_trend.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title="No timeline data yet"
            subtitle="Bounce events will plot here once campaigns start sending."
          />
        ) : (
          <div className="flex items-end gap-1 h-32">
            {r.bounce_trend.map((p) => (
              <div key={p.day} className="flex-1 flex flex-col items-center gap-1" title={`${p.day}: ${p.bounce_rate.toFixed(1)}%`}>
                <div
                  className={`w-full rounded-t ${
                    p.bounce_rate >= 5
                      ? 'bg-red-500'
                      : p.bounce_rate >= 2
                        ? 'bg-yellow-500'
                        : 'bg-blue-500'
                  }`}
                  style={{ height: `${Math.max(2, Math.min(100, p.bounce_rate * 5))}%` }}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ReputationCard({
  label,
  value,
  sub,
  warn,
  crit,
}: {
  label: string;
  value: string;
  sub: string;
  warn?: boolean;
  crit?: boolean;
}) {
  const valueColor = crit ? 'text-red-400' : warn ? 'text-yellow-400' : 'text-white';
  return (
    <div className="border border-gray-800 bg-gray-900 rounded-xl p-5">
      <div className="text-[11px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${valueColor}`}>{value}</div>
      <div className="mt-1 text-[11px] text-gray-500">{sub}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// SHARED
// ──────────────────────────────────────────────────────────────────────────
function HealthDot({ status }: { status: 'ok' | 'warning' | 'critical' }) {
  const color =
    status === 'critical'
      ? 'bg-red-500'
      : status === 'warning'
        ? 'bg-yellow-500'
        : 'bg-emerald-500';
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

function EmptyState({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Filter;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="text-center py-8">
      <Icon className="w-10 h-10 text-gray-700 mx-auto mb-3" />
      <p className="text-sm text-gray-500">{title}</p>
      <p className="text-[11px] text-gray-700 mt-1">{subtitle}</p>
    </div>
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
