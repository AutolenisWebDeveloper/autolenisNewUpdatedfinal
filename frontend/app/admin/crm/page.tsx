import Link from 'next/link';
import {
  Users,
  UserPlus,
  Activity,
  CheckCircle2,
  Inbox,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { getServiceSupabase } from '@/lib/supabase-service';
import type { LifecycleStage, TimelineEvent } from '@/lib/types/crm';
import { OverviewActivityTable, type ActivityRow } from '@/components/admin/crm/OverviewActivityTable';
import { KpiCard, Badge } from '@/components/admin/crm/ui';
import { PageHeader } from '@/components/admin/crm/ui/PageHeader';

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
  prequal_started: 'Prequal started',
  prequal_completed: 'Prequal completed',
  deposit_pending: 'Deposit pending',
  deposit_paid: 'Deposit paid',
  auction_active: 'Auction active',
  offer_received: 'Offer received',
  purchase_completed: 'Purchased',
  inactive: 'Inactive',
};

const ACTIVE_LEAD_STAGES: LifecycleStage[] = [
  'lead', 'prequal_started', 'prequal_completed', 'deposit_pending',
];
const IN_PROGRESS_STAGES: LifecycleStage[] = [
  'deposit_paid', 'auction_active', 'offer_received',
];

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
  const events = ((eventsRes.data ?? []) as unknown as RawEvent[]).map((ev) => {
    const contact = Array.isArray(ev.contact) ? ev.contact[0] ?? null : ev.contact;
    const name = contact
      ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') ||
        contact.email ||
        'Unknown'
      : 'Unknown';
    return { ...ev, name } as RawEvent & { name: string };
  });

  const activityRows: ActivityRow[] = events.map((ev) => ({
    id: ev.id,
    contactId: ev.contact_id,
    eventType: ev.event_type,
    name: ev.name,
    createdAt: ev.created_at,
  }));

  return (
    <div className="p-6 space-y-6" data-testid="crm-overview">
      <PageHeader
        title="CRM overview"
        subtitle="Operational snapshot across the entire contact lifecycle."
        data-testid="crm-overview-header"
        actions={
          <Link
            href="/admin/crm/contacts"
            data-testid="crm-overview-view-contacts"
            className="inline-flex items-center gap-1.5 rounded-[var(--crm-radius-sm)] border border-[var(--crm-border-strong)] crm-hairline bg-[var(--crm-bg-primary)] px-3 py-1.5 text-[13px] font-medium text-[var(--crm-text-secondary)] transition-colors hover:bg-[var(--crm-bg-secondary)] hover:text-[var(--crm-text-primary)]"
          >
            View contacts <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />

      {/* Alert banners */}
      {(overdue > 0 || unread > 0) && (
        <div className="grid gap-3" data-testid="crm-overview-alerts">
          {overdue > 0 && (
            <Link
              href="/admin/crm/tasks"
              data-testid="crm-overview-alert-overdue"
              className="flex items-center gap-3 rounded-[var(--crm-radius-md)] border border-[var(--crm-danger-subtle)] crm-hairline bg-[var(--crm-danger-subtle)] px-4 py-3 transition-colors hover:brightness-[0.99]"
            >
              <AlertTriangle className="h-5 w-5 text-[var(--crm-danger)]" />
              <div className="flex-1">
                <div className="text-[13px] font-medium text-[var(--crm-danger)]">
                  {overdue} overdue task{overdue === 1 ? '' : 's'}
                </div>
                <div className="text-[12px] text-[var(--crm-text-tertiary)]">
                  Tasks past their due date need attention.
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-[var(--crm-danger)]" />
            </Link>
          )}
          {unread > 0 && (
            <Link
              href="/admin/crm/inbox"
              data-testid="crm-overview-alert-unread"
              className="flex items-center gap-3 rounded-[var(--crm-radius-md)] border border-[var(--crm-info-subtle)] crm-hairline bg-[var(--crm-info-subtle)] px-4 py-3 transition-colors hover:brightness-[0.99]"
            >
              <Inbox className="h-5 w-5 text-[var(--crm-info)]" />
              <div className="flex-1">
                <div className="text-[13px] font-medium text-[var(--crm-info)]">
                  {unread} unread message{unread === 1 ? '' : 's'}
                </div>
                <div className="text-[12px] text-[var(--crm-text-tertiary)]">
                  Inbound conversations awaiting reply.
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-[var(--crm-info)]" />
            </Link>
          )}
        </div>
      )}

      {/* KPI grid */}
      <div
        className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6"
        data-testid="crm-overview-kpis"
      >
        <KpiCard icon={Users} label="Total contacts" value={totalContacts} data-testid="crm-kpi-total" />
        <KpiCard icon={UserPlus} label="Active leads" value={activeLeads} data-testid="crm-kpi-active" />
        <KpiCard icon={Activity} label="In progress" value={inProgress} data-testid="crm-kpi-in-progress" />
        <KpiCard icon={CheckCircle2} label="Purchased" value={purchased} data-testid="crm-kpi-purchased" />
        <KpiCard icon={Inbox} label="Unread messages" value={unread} data-testid="crm-kpi-unread" />
        <KpiCard icon={AlertTriangle} label="Overdue tasks" value={overdue} data-testid="crm-kpi-overdue" />
      </div>

      {/* Acquisition funnel */}
      <section
        className="rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] p-5"
        data-testid="crm-overview-funnel"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[13px] font-medium text-[var(--crm-text-primary)]">Acquisition funnel</h2>
          <span className="text-[12px] text-[var(--crm-text-tertiary)]">By lifecycle stage</span>
        </div>
        <div className="space-y-2">
          {STAGE_ORDER.map((stage) => {
            const count = stageCounts[stage];
            const pct = (count / maxStage) * 100;
            return (
              <div key={stage} className="flex items-center gap-3 text-[12px]">
                <div className="w-32 shrink-0 text-[var(--crm-text-secondary)]">{STAGE_LABEL[stage]}</div>
                <div className="h-5 flex-1 overflow-hidden rounded-[var(--crm-radius-sm)] bg-[var(--crm-bg-tertiary)]">
                  <div
                    className="h-full rounded-[var(--crm-radius-sm)] bg-[var(--crm-primary)] transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="w-12 text-right tabular-nums text-[var(--crm-text-tertiary)]">{count}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Recent activity */}
      <section data-testid="crm-overview-activity">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-medium text-[var(--crm-text-primary)]">Recent activity</h2>
          <Badge tone="neutral" data-testid="crm-overview-activity-count">
            {activityRows.length} event{activityRows.length === 1 ? '' : 's'}
          </Badge>
        </div>
        <OverviewActivityTable rows={activityRows} />
      </section>
    </div>
  );
}
