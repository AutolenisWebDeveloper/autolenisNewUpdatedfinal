import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Activity,
  Database,
  ShieldCheck,
  Zap,
  Server,
  Users,
} from 'lucide-react';
import { getServiceSupabase } from '@/lib/supabase-service';
import { OperationsService } from '@/lib/services/operations.service';
import { DlqRetryButton } from '@/components/admin/crm/DlqRetryButton';
import { RefreshAnalyticsButton } from '@/components/admin/crm/RefreshAnalyticsButton';
import { formatNumber } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
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

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = getServiceSupabase();
  const ops = new OperationsService(supabase);

  const [health, dlq, failed, audit] = await Promise.all([
    ops.getHealth(),
    ops.listDeadLetterJobs(50),
    ops.listFailedEnrollments(50),
    ops.listAuditLog({ limit: 200, query: q }),
  ]);

  const healthBanner =
    health.status === 'critical'
      ? { className: 'bg-red-500/10 border-red-500/30 text-red-300', icon: AlertTriangle, text: 'System degraded — high failure backlog. Drain DLQ and failed enrollments.' }
      : health.status === 'degraded'
        ? { className: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300', icon: AlertTriangle, text: 'Minor issues detected — review failed jobs below.' }
        : { className: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300', icon: CheckCircle2, text: 'All systems nominal.' };
  const BannerIcon = healthBanner.icon;

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Operations</h1>
          <p className="text-sm text-gray-500 mt-1">
            System health, queue failures, workflow exits, and the admin audit log.
          </p>
        </div>
        <RefreshAnalyticsButton />
      </header>

      <div className={`flex items-center gap-3 border rounded-xl px-4 py-3 ${healthBanner.className}`}>
        <BannerIcon className="w-5 h-5 shrink-0" />
        <div className="text-sm font-semibold">{healthBanner.text}</div>
      </div>

      {/* ─── Panel 1: System Health ────────────────────────────────────── */}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <HealthCard
          icon={Server}
          label="Dead-Letter Jobs"
          value={health.dead_letter_count}
          accent={health.dead_letter_count > 0 ? 'red' : 'ok'}
        />
        <HealthCard
          icon={Zap}
          label="Failed Enrollments"
          value={health.failed_enrollments_count}
          accent={health.failed_enrollments_count > 0 ? 'red' : 'ok'}
        />
        <HealthCard
          icon={Activity}
          label="Active Enrollments"
          value={health.active_enrollments_count}
          accent="blue"
        />
        <HealthCard
          icon={Database}
          label="In-Flight Idempotency"
          value={health.pending_idempotency_count}
          accent={health.pending_idempotency_count > 25 ? 'yellow' : 'ok'}
        />
        <div className="border border-gray-800 bg-gray-900 rounded-xl p-4">
          <ShieldCheck className="w-5 h-5 text-gray-500" />
          <div className="mt-3 text-sm font-semibold text-white">
            {relativeTime(health.last_analytics_refresh_at)}
          </div>
          <div className="mt-0.5 text-[11px] text-gray-500">Last analytics refresh</div>
        </div>
      </section>

      {/* ─── Panel 2: Dead Letter Queue ────────────────────────────────── */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <header className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Dead Letter Queue</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Inngest jobs that exhausted their retry budget. Retrying re-emits the original event.
            </p>
          </div>
          <span className="text-[11px] text-gray-500">{dlq.length} of {health.dead_letter_count}</span>
        </header>
        {dlq.length === 0 ? (
          <div className="p-10 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
            <p className="text-sm text-emerald-400 font-semibold">No failed jobs</p>
            <p className="text-[11px] text-gray-600 mt-1">
              All queue workers are succeeding within their retry budget.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-950/30">
                  <th className="text-left px-4 py-2">Event</th>
                  <th className="text-left px-4 py-2">Error</th>
                  <th className="text-left px-4 py-2 w-32">Failed</th>
                  <th className="text-right px-4 py-2 w-28">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {dlq.map((job) => (
                  <tr key={job.id} className="hover:bg-gray-800/30 align-top">
                    <td className="px-4 py-2.5">
                      <code className="text-[11px] text-blue-300">{job.event_name}</code>
                      <div className="text-[10px] text-gray-700 mt-0.5 font-mono">{job.job_id.slice(0, 16)}…</div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">
                      {truncate(job.error_message, 140)}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-gray-500 tabular-nums">
                      {relativeTime(job.failed_at)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <DlqRetryButton id={job.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Panel 3: Failed Enrollments ───────────────────────────────── */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <header className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Failed Workflow Enrollments</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Workflow runs that exited or failed mid-execution.
            </p>
          </div>
          <span className="text-[11px] text-gray-500">{failed.length} of {health.failed_enrollments_count}</span>
        </header>
        {failed.length === 0 ? (
          <div className="p-10 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
            <p className="text-sm text-emerald-400 font-semibold">No failed enrollments</p>
            <p className="text-[11px] text-gray-600 mt-1">
              All workflow runs completed cleanly or are still active.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-950/30">
                  <th className="text-left px-4 py-2">Workflow</th>
                  <th className="text-left px-4 py-2">Contact</th>
                  <th className="text-left px-4 py-2">Reason</th>
                  <th className="text-left px-4 py-2 w-24">Status</th>
                  <th className="text-left px-4 py-2 w-32">Enrolled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {failed.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-800/30">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/crm/automations/${e.workflow_id}/edit`}
                        className="text-white hover:text-blue-300"
                      >
                        {e.workflow_name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/crm/contacts/${e.contact_id}`}
                        className="text-gray-300 hover:text-blue-300"
                      >
                        {e.contact_email ?? e.contact_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">
                      {e.exit_reason ?? '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${
                          e.status === 'failed'
                            ? 'bg-red-500/15 text-red-400'
                            : 'bg-gray-700 text-gray-300'
                        }`}
                      >
                        {e.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-gray-500 tabular-nums">
                      {relativeTime(e.enrolled_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Panel 4: Admin Audit Log ──────────────────────────────────── */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <header className="px-5 py-4 border-b border-gray-800 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Admin Audit Log</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Last {audit.length} admin mutations across the platform.
            </p>
          </div>
          <form action="/admin/operations" className="flex items-center gap-2">
            <input
              type="text"
              name="q"
              defaultValue={q ?? ''}
              placeholder="Search action or entity…"
              className="bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:border-blue-500 outline-none w-56"
            />
            <button
              type="submit"
              className="text-xs px-3 py-1.5 border border-gray-700 hover:border-gray-600 text-gray-400 rounded-lg"
            >
              Search
            </button>
          </form>
        </header>
        {audit.length === 0 ? (
          <div className="p-10 text-center">
            <Users className="w-10 h-10 text-gray-700 mx-auto mb-3" />
            <p className="text-sm text-gray-500">
              {q ? 'No audit log entries match your search.' : 'No admin activity yet.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-950/30">
                  <th className="text-left px-4 py-2">Action</th>
                  <th className="text-left px-4 py-2">Admin</th>
                  <th className="text-left px-4 py-2">Entity</th>
                  <th className="text-left px-4 py-2">IP</th>
                  <th className="text-left px-4 py-2 w-32">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {audit.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-800/30">
                    <td className="px-4 py-2.5">
                      <code className="text-[11px] text-blue-300">{row.action}</code>
                    </td>
                    <td className="px-4 py-2.5 text-gray-300 text-xs">
                      {row.admin_email ?? <span className="text-gray-700">{row.admin_id.slice(0, 8)}…</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">
                      {row.entity_type ? (
                        <>
                          <span>{row.entity_type}</span>
                          {row.entity_id && (
                            <code className="text-[10px] text-gray-600 ml-1">
                              {row.entity_id.slice(0, 8)}…
                            </code>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-700">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-[11px] font-mono">
                      {row.ip_address ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-gray-500 tabular-nums">
                      {relativeTime(row.created_at)}
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

function HealthCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Server;
  label: string;
  value: number;
  accent: 'ok' | 'blue' | 'yellow' | 'red';
}) {
  const ring =
    accent === 'red'
      ? 'border-red-500/30 bg-red-500/5'
      : accent === 'yellow'
        ? 'border-yellow-500/30 bg-yellow-500/5'
        : accent === 'blue'
          ? 'border-blue-500/30 bg-blue-500/5'
          : 'border-gray-800 bg-gray-900';
  const iconColor =
    accent === 'red'
      ? 'text-red-400'
      : accent === 'yellow'
        ? 'text-yellow-400'
        : accent === 'blue'
          ? 'text-blue-400'
          : 'text-gray-500';
  return (
    <div className={`border rounded-xl p-4 ${ring}`}>
      <Icon className={`w-5 h-5 ${iconColor}`} />
      <div className="mt-3 text-2xl font-bold text-white tabular-nums">{formatNumber(value)}</div>
      <div className="mt-0.5 text-[11px] text-gray-500">{label}</div>
    </div>
  );
}
