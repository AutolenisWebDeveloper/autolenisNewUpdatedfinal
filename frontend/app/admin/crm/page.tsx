import Link from 'next/link';
import {
  Users,
  UserPlus,
  Activity,
  CheckCircle2,
  Inbox,
  AlertTriangle,
  ArrowRight,
  Send,
  Zap,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';
import { getServiceSupabase } from '@/lib/supabase-service';
import type { LifecycleStage, TimelineEvent } from '@/lib/types/crm';
import { timelineVisual } from '@/components/admin/crm/TimelineIcon';

export const dynamic = 'force-dynamic';

const STAGE_ORDER: LifecycleStage[] = [
  'lead',
  'prequal_started',
  'prequal_completed',
  'deposit_pending',
  'deposit_paid',
  'auction_active',
  'offer_received',
  'purchase_completed',
  'inactive',
];

const STAGE_LABEL: Record<LifecycleStage, string> = {
  lead: 'Lead',
  prequal_started: 'Prequal Started',
  prequal_completed: 'Prequal Completed',
  deposit_pending: 'Deposit Pending',
  deposit_paid: 'Deposit Paid',
  auction_active: 'Auction Active',
  offer_received: 'Offer Received',
  purchase_completed: 'Purchased',
  inactive: 'Inactive',
};

const STAGE_BAR: Record<LifecycleStage, string> = {
  lead: 'bg-gray-600',
  prequal_started: 'bg-yellow-600',
  prequal_completed: 'bg-yellow-500',
  deposit_pending: 'bg-orange-500',
  deposit_paid: 'bg-green-600',
  auction_active: 'bg-blue-600',
  offer_received: 'bg-purple-600',
  purchase_completed: 'bg-emerald-600',
  inactive: 'bg-gray-700',
};

const ACTIVE_LEAD_STAGES: LifecycleStage[] = [
  'lead', 'prequal_started', 'prequal_completed', 'deposit_pending',
];
const IN_PROGRESS_STAGES: LifecycleStage[] = [
  'deposit_paid', 'auction_active', 'offer_received',
];

function relativeTime(iso: string): string {
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

export default async function CrmOverviewPage() {
  const supabase = getServiceSupabase();
  const nowIso = new Date().toISOString();

  const [
    totalRes,
    activeRes,
    inProgressRes,
    purchasedRes,
    unreadRes,
    overdueRes,
    stagesRes,
    eventsRes,
  ] = await Promise.all([
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .in('lifecycle_stage', ACTIVE_LEAD_STAGES),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .in('lifecycle_stage', IN_PROGRESS_STAGES),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .eq('lifecycle_stage', 'purchase_completed'),
    supabase
      .from('conversations')
      .select('unread_count')
      .gt('unread_count', 0),
    supabase
      .from('crm_tasks')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'in_progress'])
      .lt('due_at', nowIso),
    supabase
      .from('contacts')
      .select('lifecycle_stage')
      .is('deleted_at', null),
    supabase
      .from('contact_timeline_events')
      .select('id, contact_id, event_type, event_data, created_at, contact:contacts(first_name, last_name, email)')
      .order('created_at', { ascending: false })
      .limit(8),
  ]);

  const unread = (unreadRes.data ?? []).reduce(
    (acc, r) => acc + Number(r.unread_count ?? 0),
    0,
  );

  const stageCounts = STAGE_ORDER.reduce<Record<LifecycleStage, number>>(
    (acc, s) => ({ ...acc, [s]: 0 }),
    {} as Record<LifecycleStage, number>,
  );
  for (const row of stagesRes.data ?? []) {
    const s = row.lifecycle_stage as LifecycleStage;
    if (s in stageCounts) stageCounts[s] += 1;
  }
  const maxStage = Math.max(1, ...Object.values(stageCounts));

  const totalContacts = totalRes.count ?? 0;
  const activeLeads = activeRes.count ?? 0;
  const inProgress = inProgressRes.count ?? 0;
  const purchased = purchasedRes.count ?? 0;
  const overdue = overdueRes.count ?? 0;

  type RawEvent = Pick<TimelineEvent, 'id' | 'contact_id' | 'event_type' | 'event_data' | 'created_at'> & {
    contact:
      | { first_name: string | null; last_name: string | null; email: string | null }
      | { first_name: string | null; last_name: string | null; email: string | null }[]
      | null;
  };
  const events = ((eventsRes.data ?? []) as unknown as RawEvent[]).map((ev) => ({
    ...ev,
    contact: Array.isArray(ev.contact) ? ev.contact[0] ?? null : ev.contact,
  }));

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-xl font-bold text-gray-900">CRM Overview</h1>
        <p className="text-sm text-gray-500 mt-1">
          Operational snapshot across the entire contact lifecycle.
        </p>
      </header>

      {/* Alert banners */}
      <div className="grid gap-3">
        {overdue > 0 && (
          <Link
            href="/admin/crm/tasks"
            className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 hover:bg-red-50 transition-colors"
          >
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-red-700">
                {overdue} overdue task{overdue === 1 ? '' : 's'}
              </div>
              <div className="text-xs text-red-700/70">
                Tasks past their due date need attention.
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-red-700" />
          </Link>
        )}
        {unread > 0 && (
          <Link
            href="/admin/crm/inbox"
            className="flex items-center gap-3 bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3 hover:bg-blue-50 transition-colors"
          >
            <Inbox className="w-5 h-5 text-blue-600" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-blue-700">
                {unread} unread message{unread === 1 ? '' : 's'}
              </div>
              <div className="text-xs text-blue-700/70">
                Inbound conversations awaiting reply.
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-blue-700" />
          </Link>
        )}
      </div>

      {/* Metric grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <MetricCard icon={Users}        label="Total Contacts" value={totalContacts} />
        <MetricCard icon={UserPlus}     label="Active Leads"   value={activeLeads} />
        <MetricCard icon={Activity}     label="In Progress"    value={inProgress} />
        <MetricCard icon={CheckCircle2} label="Purchased"      value={purchased} accent="emerald" />
        <MetricCard icon={Inbox}        label="Unread Msgs"    value={unread} accent={unread > 0 ? 'blue' : undefined} />
        <MetricCard icon={AlertTriangle} label="Overdue Tasks"  value={overdue} accent={overdue > 0 ? 'red' : undefined} />
      </div>

      {/* Lifecycle funnel */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">Lifecycle Funnel</h2>
          <Link
            href="/admin/crm/contacts"
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            View contacts →
          </Link>
        </div>
        <div className="space-y-2">
          {STAGE_ORDER.map((stage) => {
            const count = stageCounts[stage];
            const pct = (count / maxStage) * 100;
            return (
              <div key={stage} className="flex items-center gap-3 text-xs">
                <div className="w-32 text-gray-500 shrink-0">{STAGE_LABEL[stage]}</div>
                <div className="flex-1 h-5 bg-white rounded overflow-hidden">
                  <div
                    className={`h-full ${STAGE_BAR[stage]} transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="w-12 text-right text-gray-400 tabular-nums">{count}</div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Activity feed */}
        <section className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Recent Activity</h2>
          {events.length === 0 ? (
            <div className="py-10 text-center">
              <Activity className="w-10 h-10 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No activity yet</p>
              <p className="text-[11px] text-gray-400">
                Timeline events will appear here as contacts move through the funnel.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {events.map((ev) => {
                const v = timelineVisual(ev.event_type);
                const Icon = v.icon;
                const name = ev.contact
                  ? [ev.contact.first_name, ev.contact.last_name].filter(Boolean).join(' ') ||
                    ev.contact.email ||
                    'Unknown'
                  : 'Unknown';
                return (
                  <Link
                    key={ev.id}
                    href={`/admin/crm/contacts/${ev.contact_id}`}
                    className="flex items-start gap-3 py-2.5 hover:bg-gray-50 -mx-2 px-2 rounded-lg transition-colors"
                  >
                    <Icon className={`w-4 h-4 mt-0.5 ${v.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm">
                        <span className={v.color}>{v.label}</span>{' '}
                        <span className="text-gray-500">·</span>{' '}
                        <span className="text-gray-900">{name}</span>
                      </div>
                    </div>
                    <div className="text-[11px] text-gray-500 shrink-0 tabular-nums">
                      {relativeTime(ev.created_at)}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* Quick actions */}
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="space-y-2">
            <QuickAction href="/admin/crm/campaigns"   icon={Send}      label="New Campaign" />
            <QuickAction href="/admin/crm/automations" icon={Zap}       label="New Workflow" />
            <QuickAction href="/admin/crm/contacts"    icon={Users}     label="All Contacts" />
            <QuickAction href="/admin/crm/analytics"   icon={BarChart3} label="Analytics" />
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  accent?: 'blue' | 'red' | 'emerald';
}) {
  const accentClass =
    accent === 'blue'
      ? 'border-blue-500/30 bg-blue-500/5'
      : accent === 'red'
        ? 'border-red-200 bg-red-500/5'
        : accent === 'emerald'
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-gray-200 bg-white';
  const iconColor =
    accent === 'blue'
      ? 'text-blue-600'
      : accent === 'red'
        ? 'text-red-600'
        : accent === 'emerald'
          ? 'text-emerald-700'
          : 'text-gray-500';
  return (
    <div className={`border rounded-xl p-4 ${accentClass}`}>
      <Icon className={`w-5 h-5 ${iconColor}`} />
      <div className="mt-3 text-2xl font-bold text-gray-900 tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-gray-500">{label}</div>
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white hover:bg-gray-100 border border-gray-200 hover:border-gray-300 text-sm text-gray-400 hover:text-gray-900 transition-colors"
    >
      <Icon className="w-4 h-4 text-blue-500" />
      <span className="flex-1">{label}</span>
      <ArrowRight className="w-3.5 h-3.5 text-gray-500" />
    </Link>
  );
}
