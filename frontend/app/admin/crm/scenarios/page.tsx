import { ExternalLink, Workflow, Mail, MessageSquare, Radio } from 'lucide-react';
import { getServiceSupabase } from '@/lib/supabase-service';
import { prisma } from '@/lib/prisma';
import { SCENARIO_REGISTRY, type ScenarioStatus } from '@/lib/crm/scenario-registry';

export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<ScenarioStatus, string> = {
  live: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  draft: 'bg-amber-50 text-amber-700 border-amber-200',
  planned: 'bg-gray-100 text-gray-600 border-gray-200',
  paused: 'bg-red-50 text-red-700 border-red-200',
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
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-xl font-bold text-gray-900">Make.com Scenarios</h1>
        <p className="text-sm text-gray-500 mt-1">
          Read-only monitor. AutoLenis emits domain events; Make.com orchestrates and calls back
          into <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">/api/crm/dispatch/*</code> to
          act. Every send, consent check, and audit stays owned by AutoLenis.
        </p>
      </header>

      {/* Live 24h counters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Counter icon={Radio} label="Events Emitted (24h)" value={eventsEmitted} />
        <Counter icon={Mail} label="Email Dispatched (24h)" value={emailDispatched} accent="blue" />
        <Counter icon={MessageSquare} label="SMS Dispatched (24h)" value={smsDispatched} accent="blue" />
        <Counter icon={Mail} label="Email Sends Logged (24h)" value={emailLogCount} />
      </div>

      {/* Registry */}
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-2">
          <Workflow className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Registered Scenarios</h2>
          <span className="ml-auto text-xs text-gray-400">{SCENARIO_REGISTRY.length} total</span>
        </div>
        <div className="divide-y divide-gray-100">
          {SCENARIO_REGISTRY.map((s) => (
            <div key={s.name} className="px-5 py-4 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">{s.name}</span>
                  <span
                    className={`text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 ${STATUS_STYLE[s.status]}`}
                  >
                    {s.status}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{s.description}</p>
                <code className="inline-block mt-2 text-[11px] bg-gray-50 border border-gray-200 text-gray-600 rounded px-1.5 py-0.5">
                  on: {EVENT_LABEL[s.event] ?? s.event}
                </code>
              </div>
              {s.makeUrl ? (
                <a
                  href={s.makeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                >
                  Open in Make <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <span className="shrink-0 text-xs text-gray-400">Not yet linked</span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Counter({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Mail;
  label: string;
  value: number;
  accent?: 'blue';
}) {
  return (
    <div
      className={`border rounded-xl p-4 ${
        accent === 'blue' ? 'border-blue-500/30 bg-blue-500/5' : 'border-gray-200 bg-white'
      }`}
    >
      <Icon className={`w-5 h-5 ${accent === 'blue' ? 'text-blue-600' : 'text-gray-500'}`} />
      <div className="mt-3 text-2xl font-bold text-gray-900 tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-gray-500">{label}</div>
    </div>
  );
}
