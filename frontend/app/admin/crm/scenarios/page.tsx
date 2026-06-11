import { ExternalLink, Workflow, Mail, MessageSquare, Radio } from 'lucide-react';
import { getServiceSupabase } from '@/lib/supabase-service';
import { prisma } from '@/lib/prisma';
import { SCENARIO_REGISTRY, type ScenarioStatus } from '@/lib/crm/scenario-registry';
import { Badge, KpiCard, PageHeader, type Tone } from '@/components/admin/crm/ui';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<ScenarioStatus, Tone> = {
  live: 'success',
  draft: 'warning',
  planned: 'neutral',
  paused: 'danger',
};

const EVENT_LABEL: Record<string, string> = {
  buyer_signup: 'buyer_signup',
  vehicle_request_submitted: 'vehicle_request_submitted',
  affiliate_signup: 'affiliate_signup',
  dealer_invited: 'dealer_invited',
  refinance_inquiry: 'refinance_inquiry',
};

export default async function CrmScenariosPage() {
  const supabase = getServiceSupabase();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const [emailRes, smsRes, eventRes, emailLogCount] = await Promise.all([
    supabase
      .from('contact_timeline_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'email_sent')
      .gte('created_at', since),
    supabase
      .from('contact_timeline_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'sms_sent')
      .gte('created_at', since),
    supabase
      .from('contact_timeline_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'domain_event')
      .gte('created_at', since),
    prisma.emailSendLog
      .count({ where: { sentAt: { gte: new Date(since) }, status: 'SENT' } })
      .catch(() => 0),
  ]);

  const emailDispatched = emailRes.count ?? 0;
  const smsDispatched = smsRes.count ?? 0;
  const eventsEmitted = eventRes.count ?? 0;

  return (
    <div className="space-y-6 p-6" data-testid="crm-scenarios">
      <PageHeader
        title="Make.com scenarios"
        subtitle="Read-only monitor. AutoLenis emits domain events; Make.com orchestrates and calls back into /api/crm/dispatch/* to act. Every send, consent check, and audit stays owned by AutoLenis."
        data-testid="crm-scenarios-header"
      />

      {/* Live 24h counters */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Events emitted (24h)"
          value={eventsEmitted}
          icon={Radio}
          data-testid="crm-scenarios-kpi-events"
        />
        <KpiCard
          label="Email dispatched (24h)"
          value={emailDispatched}
          icon={Mail}
          data-testid="crm-scenarios-kpi-email"
        />
        <KpiCard
          label="SMS dispatched (24h)"
          value={smsDispatched}
          icon={MessageSquare}
          data-testid="crm-scenarios-kpi-sms"
        />
        <KpiCard
          label="Email sends logged (24h)"
          value={emailLogCount}
          icon={Mail}
          data-testid="crm-scenarios-kpi-email-log"
        />
      </div>

      {/* Registry */}
      <section className="overflow-hidden rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)]">
        <div className="flex items-center gap-2 border-b border-[var(--crm-border)] crm-hairline px-5 py-4">
          <Workflow className="h-4 w-4 text-[var(--crm-text-tertiary)]" />
          <h2 className="text-[13px] font-medium text-[var(--crm-text-primary)]">Registered scenarios</h2>
          <span className="ml-auto text-[12px] text-[var(--crm-text-tertiary)]">
            {SCENARIO_REGISTRY.length} total
          </span>
        </div>
        <div className="divide-y divide-[var(--crm-border)]">
          {SCENARIO_REGISTRY.map((s) => (
            <div key={s.name} className="flex items-start gap-4 px-5 py-4" data-testid="crm-scenario-row">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-[var(--crm-text-primary)]">{s.name}</span>
                  <Badge tone={STATUS_TONE[s.status]} size="sm" className="capitalize" data-testid="crm-scenario-status">
                    {s.status}
                  </Badge>
                </div>
                <p className="mt-1 text-[12px] text-[var(--crm-text-tertiary)]">{s.description}</p>
                <code className="mt-2 inline-block rounded-[var(--crm-radius-sm)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-secondary)] px-1.5 py-0.5 text-[11px] text-[var(--crm-text-secondary)]">
                  on: {EVENT_LABEL[s.event] ?? s.event}
                </code>
              </div>
              {s.makeUrl ? (
                <a
                  href={s.makeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="crm-scenario-open"
                  className="inline-flex shrink-0 items-center gap-1 text-[12px] text-[var(--crm-primary)] hover:text-[var(--crm-primary-hover)]"
                >
                  Open in Make <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span className="shrink-0 text-[12px] text-[var(--crm-text-tertiary)]">Not yet linked</span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
