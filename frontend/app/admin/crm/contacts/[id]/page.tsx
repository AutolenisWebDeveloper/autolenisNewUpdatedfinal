import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Mail,
  Phone,
  Globe,
  Calendar,
  MessageSquare,
  AlertTriangle,
  Pencil,
  Plus,
  Clock,
  ChevronLeft,
  Check,
  X as XIcon,
} from 'lucide-react';
import { getServiceSupabase } from '@/lib/supabase-service';
import { ContactService } from '@/lib/services/contact.service';
import type { TimelineEvent, CRMTask } from '@/lib/types/crm';
import { StageBadge } from '@/components/admin/crm/StageBadge';
import { timelineVisual } from '@/components/admin/crm/TimelineIcon';

export const dynamic = 'force-dynamic';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatPhone(phone: string | null): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-gray-500',
};

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getServiceSupabase();

  const contact = await ContactService.getContactById(supabase, id);
  if (!contact) {
    notFound();
  }

  const [{ data: timelineRows }, { data: openTasks }] = await Promise.all([
    supabase
      .from('contact_timeline_events')
      .select('*')
      .eq('contact_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('crm_tasks')
      .select('*')
      .eq('contact_id', id)
      .in('status', ['open', 'in_progress'])
      .order('due_at', { ascending: true, nullsFirst: false }),
  ]);

  const timeline = (timelineRows ?? []) as TimelineEvent[];
  const tasks = (openTasks ?? []) as CRMTask[];

  const name =
    [contact.first_name, contact.last_name].filter(Boolean).join(' ') ||
    contact.email ||
    contact.phone ||
    'Unknown';
  const initials = (contact.first_name?.[0] ?? contact.email?.[0] ?? '?').toUpperCase();
  const hasAttribution =
    contact.utm_source || contact.utm_medium || contact.utm_campaign || contact.source_url;

  return (
    <div className="p-6 space-y-5">
      <Link
        href="/admin/crm/contacts"
        className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Back to contacts
      </Link>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Left column — profile */}
        <div className="space-y-4">
          {/* Identity */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex justify-end -mt-1 -mr-1">
              <button
                className="p-1.5 text-gray-500 hover:text-gray-300 rounded-md hover:bg-gray-800/60"
                aria-label="Edit contact"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex flex-col items-center text-center -mt-4">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center text-2xl font-bold text-white">
                {initials}
              </div>
              <h2 className="mt-3 text-base font-semibold text-white">{name}</h2>
              <div className="mt-1.5">
                <StageBadge stage={contact.lifecycle_stage} />
              </div>
            </div>

            {contact.do_not_contact && (
              <div className="mt-4 flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-semibold text-red-300">Do not contact</div>
                  <div className="text-[11px] text-red-300/70 mt-0.5">
                    This contact has opted out. No outbound messages will be sent.
                  </div>
                </div>
              </div>
            )}

            <div className="mt-5 space-y-3 text-sm">
              <DetailRow icon={Mail}     label={contact.email ?? '—'} />
              <DetailRow icon={Phone}    label={formatPhone(contact.phone)} />
              <DetailRow icon={Globe}    label={contact.source ?? '—'} />
              <DetailRow icon={Calendar} label={`Added ${formatDate(contact.created_at)}`} />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                disabled={!contact.email || !contact.consent_email}
                className="flex items-center justify-center gap-1.5 text-xs font-medium border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white rounded-lg px-3 py-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Mail className="w-3.5 h-3.5" /> Email
              </button>
              <button
                disabled={!contact.phone || !contact.consent_sms}
                className="flex items-center justify-center gap-1.5 text-xs font-medium border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white rounded-lg px-3 py-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5" /> SMS
              </button>
            </div>
          </div>

          {/* Consent */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Consent
            </h3>
            <div className="space-y-2.5 text-sm">
              <ConsentRow label="SMS consent"   granted={contact.consent_sms} />
              <ConsentRow label="Email consent" granted={contact.consent_email} />
            </div>
            {contact.consent_at && (
              <div className="mt-3 text-[11px] text-gray-600">
                Captured {formatDate(contact.consent_at)}
              </div>
            )}
          </div>

          {/* Attribution */}
          {hasAttribution && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Attribution
              </h3>
              <div className="space-y-2 text-xs">
                {contact.utm_source && (
                  <AttributionRow label="utm_source" value={contact.utm_source} />
                )}
                {contact.utm_medium && (
                  <AttributionRow label="utm_medium" value={contact.utm_medium} />
                )}
                {contact.utm_campaign && (
                  <AttributionRow label="utm_campaign" value={contact.utm_campaign} />
                )}
                {contact.source_url && (
                  <AttributionRow label="source_url" value={contact.source_url} />
                )}
              </div>
            </div>
          )}

          {/* Open tasks */}
          {tasks.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Open Tasks
                </h3>
                <button className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-0.5">
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
              <div className="space-y-2">
                {tasks.map((task) => {
                  const overdue =
                    !!task.due_at && new Date(task.due_at).getTime() < Date.now();
                  return (
                    <div
                      key={task.id}
                      className="flex items-start gap-2.5 text-sm py-1"
                    >
                      <span
                        className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                          PRIORITY_DOT[task.priority] ?? 'bg-gray-500'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-white truncate">{task.title}</div>
                        {task.due_at && (
                          <div
                            className={`text-[11px] mt-0.5 ${
                              overdue ? 'text-red-400' : 'text-gray-600'
                            }`}
                          >
                            {overdue ? 'Overdue · ' : 'Due '}
                            {formatDate(task.due_at)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right column — timeline */}
        <div className="lg:col-span-2">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Activity Timeline</h2>
              <div className="flex items-center gap-2">
                <button className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-md px-2.5 py-1 transition-colors">
                  Add Note
                </button>
                <button className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-md px-2.5 py-1 transition-colors">
                  Add Task
                </button>
              </div>
            </div>

            {timeline.length === 0 ? (
              <div className="py-16 text-center">
                <Clock className="w-10 h-10 text-gray-700 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No activity yet</p>
                <p className="text-[11px] text-gray-700 mt-1">
                  Events appear here as the contact moves through the funnel.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-800/60">
                {timeline.map((ev) => {
                  const v = timelineVisual(ev.event_type);
                  const Icon = v.icon;
                  return (
                    <div key={ev.id} className="flex items-start gap-3 py-3">
                      <div className={`mt-0.5 ${v.color}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">
                          <span className={v.color}>{v.label}</span>
                        </div>
                        {ev.event_data && Object.keys(ev.event_data).length > 0 && (
                          <div className="text-[11px] text-gray-600 mt-0.5 truncate">
                            {summarizeEventData(ev.event_data)}
                          </div>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-600 shrink-0 tabular-nums">
                        {formatDate(ev.created_at)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon: Icon, label }: { icon: typeof Mail; label: string }) {
  return (
    <div className="flex items-center gap-2.5 text-gray-300">
      <Icon className="w-3.5 h-3.5 text-gray-600 shrink-0" />
      <span className="text-sm truncate">{label}</span>
    </div>
  );
}

function ConsentRow({ label, granted }: { label: string; granted: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400 text-xs">{label}</span>
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
          granted ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gray-800 text-gray-500'
        }`}
      >
        {granted ? <Check className="w-3 h-3" /> : <XIcon className="w-3 h-3" />}
        {granted ? 'Granted' : 'Not granted'}
      </span>
    </div>
  );
}

function AttributionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-gray-600 font-mono shrink-0 w-24">{label}</span>
      <span className="text-gray-300 break-all">{value}</span>
    </div>
  );
}

function summarizeEventData(data: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v == null) continue;
    if (typeof v === 'object') continue;
    parts.push(`${k}: ${String(v)}`);
    if (parts.length >= 3) break;
  }
  return parts.join(' · ');
}

