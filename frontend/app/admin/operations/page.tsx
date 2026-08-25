import AutoRefresh from '@/components/admin/AutoRefresh';
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
  HelpCircle,
  XCircle,
  Clock,
  type LucideIcon,
} from 'lucide-react';
import { getServiceSupabase } from '@/lib/supabase-service';
import {
  OperationsService,
  type DependencyStatus,
  type CronJobRun,
} from '@/lib/services/operations.service';
import { DlqRetryButton } from '@/components/admin/crm/DlqRetryButton';
import { RefreshAnalyticsButton } from '@/components/admin/crm/RefreshAnalyticsButton';
import { Badge, Button, EmptyState, KpiCard, PageHeader, type Tone } from '@/components/admin/crm/ui';
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

const SECTION_CLASS =
  'overflow-hidden rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)]';
const TH_CLASS =
  'border-b border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-secondary)] px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--crm-text-tertiary)]';
const TD_CLASS = 'px-4 py-2.5 align-top text-[13px] text-[var(--crm-text-secondary)]';

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = getServiceSupabase();
  const ops = new OperationsService(supabase);

  const [health, deps, crons, dlq, failed, audit] = await Promise.all([
    ops.getHealth(),
    ops.getDependencyHealth(),
    ops.listCronJobs(),
    ops.listDeadLetterJobs(50),
    ops.listFailedEnrollments(50),
    ops.listAuditLog({ limit: 200, query: q }),
  ]);

  const banner =
    health.status === 'critical'
      ? { tone: 'danger' as Tone, icon: AlertTriangle, text: 'System degraded — high failure backlog. Drain DLQ and failed enrollments.' }
      : health.status === 'degraded'
        ? { tone: 'warning' as Tone, icon: AlertTriangle, text: 'Minor issues detected — review failed jobs below.' }
        : { tone: 'success' as Tone, icon: CheckCircle2, text: 'All systems nominal.' };
  const BannerIcon = banner.icon;
  const bannerColor = `var(--crm-${banner.tone})`;

  return (
    <div className="space-y-6 p-6" data-testid="crm-operations">
      <PageHeader
        title="Operations"
        subtitle="System health, queue failures, workflow exits, and the admin audit log."
        data-testid="crm-operations-header"
        actions={<><AutoRefresh intervalMs={60_000} showTimestamp={false} /><RefreshAnalyticsButton /></>}
      />

      <div
        className="flex items-center gap-3 rounded-[var(--crm-radius-md)] border px-4 py-3"
        style={{
          color: bannerColor,
          borderColor: `var(--crm-${banner.tone}-subtle)`,
          backgroundColor: `var(--crm-${banner.tone}-subtle)`,
        }}
        data-testid="crm-operations-banner"
      >
        <BannerIcon className="h-5 w-5 shrink-0" />
        <div className="text-[13px] font-medium">{banner.text}</div>
      </div>

      {/* ─── System Health Overview: dependency statuses ───────────────── */}
      <section className={SECTION_CLASS}>
        <header className="border-b border-[var(--crm-border)] crm-hairline px-5 py-4">
          <h2 className="text-[13px] font-medium text-[var(--crm-text-primary)]">System health overview</h2>
          <p className="mt-0.5 text-[12px] text-[var(--crm-text-tertiary)]">
            Live status of every platform dependency.
          </p>
        </header>
        <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-3 lg:grid-cols-6">
          {deps.map((dep) => (
            <DependencyCard key={dep.key} dep={dep} />
          ))}
        </div>
      </section>

      {/* ─── Queue metrics ─────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard
          icon={Server}
          label="Dead-letter jobs"
          value={health.dead_letter_count}
          tone={health.dead_letter_count > 0 ? 'danger' : undefined}
          testId="crm-operations-metric-dlq"
        />
        <MetricCard
          icon={Zap}
          label="Failed enrollments"
          value={health.failed_enrollments_count}
          tone={health.failed_enrollments_count > 0 ? 'danger' : undefined}
          testId="crm-operations-metric-failed"
        />
        <MetricCard
          icon={Activity}
          label="Active enrollments"
          value={health.active_enrollments_count}
          tone="primary"
          testId="crm-operations-metric-active"
        />
        <MetricCard
          icon={Database}
          label="In-flight idempotency"
          value={health.pending_idempotency_count}
          tone={health.pending_idempotency_count > 25 ? 'warning' : undefined}
          testId="crm-operations-metric-idempotency"
        />
        <KpiCard
          icon={ShieldCheck}
          label="Last analytics refresh"
          value={relativeTime(health.last_analytics_refresh_at)}
          data-testid="crm-operations-metric-refresh"
        />
      </section>

      {/* ─── Panel 2: Dead Letter Queue ────────────────────────────────── */}
      <section className={SECTION_CLASS}>
        <header className="flex items-center justify-between border-b border-[var(--crm-border)] crm-hairline px-5 py-4">
          <div>
            <h2 className="text-[13px] font-medium text-[var(--crm-text-primary)]">Job dead-letter queue</h2>
            <p className="mt-0.5 text-[12px] text-[var(--crm-text-tertiary)]">
              Automation jobs that exhausted their retry budget. Retrying re-drives the job to its internal owner.
            </p>
          </div>
          <span className="text-[12px] text-[var(--crm-text-tertiary)]">
            {dlq.length} of {health.dead_letter_count}
            {health.terminal_dead_letter_count > 0 && (
              <span className="ml-2" style={{ color: 'var(--crm-danger)' }}>
                · {health.terminal_dead_letter_count} terminal (needs review)
              </span>
            )}
          </span>
        </header>
        {dlq.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="No failed jobs"
            description="All queue workers are succeeding within their retry budget."
            data-testid="crm-operations-dlq-empty"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={TH_CLASS}>Event</th>
                  <th className={TH_CLASS}>Error</th>
                  <th className={`${TH_CLASS} w-32`}>Failed</th>
                  <th className={`${TH_CLASS} w-28 text-right`}>Action</th>
                </tr>
              </thead>
              <tbody>
                {dlq.map((job) => (
                  <tr key={job.id} className="border-b border-[var(--crm-border)] crm-hairline last:border-b-0">
                    <td className={TD_CLASS}>
                      <code className="text-[12px] text-[var(--crm-primary)]">{job.event_name}</code>
                      <div className="mt-0.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--crm-text-tertiary)]">
                        {job.job_id.slice(0, 16)}…
                      </div>
                    </td>
                    <td className={`${TD_CLASS} text-[12px]`}>{truncate(job.error_message, 140)}</td>
                    <td className={`${TD_CLASS} text-[12px] tabular-nums text-[var(--crm-text-tertiary)]`}>
                      {relativeTime(job.failed_at)}
                    </td>
                    <td className={`${TD_CLASS} text-right`}>
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
      <section className={SECTION_CLASS}>
        <header className="flex items-center justify-between border-b border-[var(--crm-border)] crm-hairline px-5 py-4">
          <div>
            <h2 className="text-[13px] font-medium text-[var(--crm-text-primary)]">Failed workflow enrollments</h2>
            <p className="mt-0.5 text-[12px] text-[var(--crm-text-tertiary)]">
              Workflow runs that exited or failed mid-execution.
            </p>
          </div>
          <span className="text-[12px] text-[var(--crm-text-tertiary)]">
            {failed.length} of {health.failed_enrollments_count}
          </span>
        </header>
        {failed.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="No failed enrollments"
            description="All workflow runs completed cleanly or are still active."
            data-testid="crm-operations-failed-empty"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={TH_CLASS}>Workflow</th>
                  <th className={TH_CLASS}>Contact</th>
                  <th className={TH_CLASS}>Reason</th>
                  <th className={`${TH_CLASS} w-24`}>Status</th>
                  <th className={`${TH_CLASS} w-32`}>Enrolled</th>
                </tr>
              </thead>
              <tbody>
                {failed.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--crm-border)] crm-hairline last:border-b-0">
                    <td className={TD_CLASS}>
                      <Link
                        href={`/admin/crm/automations/${e.workflow_id}/edit`}
                        className="text-[var(--crm-text-primary)] hover:text-[var(--crm-primary)]"
                      >
                        {e.workflow_name}
                      </Link>
                    </td>
                    <td className={TD_CLASS}>
                      <Link
                        href={`/admin/crm/contacts/${e.contact_id}`}
                        className="hover:text-[var(--crm-primary)]"
                      >
                        {e.contact_email ?? e.contact_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className={`${TD_CLASS} text-[12px]`}>{e.exit_reason ?? '—'}</td>
                    <td className={TD_CLASS}>
                      <Badge tone={e.status === 'failed' ? 'danger' : 'neutral'} size="sm" className="capitalize">
                        {e.status}
                      </Badge>
                    </td>
                    <td className={`${TD_CLASS} text-[12px] tabular-nums text-[var(--crm-text-tertiary)]`}>
                      {relativeTime(e.enrolled_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Panel 3b: Cron Job Status ─────────────────────────────────── */}
      <section className={SECTION_CLASS}>
        <header className="flex items-center justify-between border-b border-[var(--crm-border)] crm-hairline px-5 py-4">
          <div>
            <h2 className="text-[13px] font-medium text-[var(--crm-text-primary)]">Cron job status</h2>
            <p className="mt-0.5 text-[12px] text-[var(--crm-text-tertiary)]">
              Most recent run of each scheduled job.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {crons.some((j) => j.overdue) && (
              <Badge tone="danger" size="sm">
                {crons.filter((j) => j.overdue).length} overdue
              </Badge>
            )}
            <span className="text-[12px] text-[var(--crm-text-tertiary)]">
              {crons.length} job{crons.length === 1 ? '' : 's'}
            </span>
          </div>
        </header>
        {crons.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No cron history yet"
            description="Scheduled jobs will appear here after their first recorded run."
            data-testid="crm-operations-cron-empty"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={TH_CLASS}>Job</th>
                  <th className={`${TH_CLASS} w-28`}>Status</th>
                  <th className={`${TH_CLASS} w-24`}>Duration</th>
                  <th className={`${TH_CLASS} w-32`}>Last run</th>
                </tr>
              </thead>
              <tbody>
                {crons.map((job) => (
                  <CronRow key={job.id} job={job} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Panel 4: Admin Audit Log ──────────────────────────────────── */}
      <section className={SECTION_CLASS}>
        <header className="flex items-center justify-between gap-4 border-b border-[var(--crm-border)] crm-hairline px-5 py-4">
          <div>
            <h2 className="text-[13px] font-medium text-[var(--crm-text-primary)]">Admin audit log</h2>
            <p className="mt-0.5 text-[12px] text-[var(--crm-text-tertiary)]">
              Last {audit.length} admin mutations across the platform.
            </p>
          </div>
          <form action="/admin/operations" className="flex items-center gap-2" data-testid="crm-operations-audit-search">
            <input
              type="text"
              name="q"
              defaultValue={q ?? ''}
              placeholder="Search action or entity…"
              className="h-8 w-56 rounded-[var(--crm-radius-sm)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] px-3 text-[13px] text-[var(--crm-text-primary)] outline-none placeholder:text-[var(--crm-text-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)]"
            />
            <Button variant="secondary" type="submit" data-testid="crm-operations-audit-submit">
              Search
            </Button>
          </form>
        </header>
        {audit.length === 0 ? (
          <EmptyState
            icon={Users}
            title={q ? 'No audit log entries match your search.' : 'No admin activity yet.'}
            data-testid="crm-operations-audit-empty"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={TH_CLASS}>Action</th>
                  <th className={TH_CLASS}>Admin</th>
                  <th className={TH_CLASS}>Entity</th>
                  <th className={TH_CLASS}>IP</th>
                  <th className={`${TH_CLASS} w-32`}>When</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--crm-border)] crm-hairline last:border-b-0">
                    <td className={TD_CLASS}>
                      <code className="text-[12px] text-[var(--crm-primary)]">{row.action}</code>
                    </td>
                    <td className={`${TD_CLASS} text-[12px]`}>
                      {row.admin_email ?? (
                        <span className="text-[var(--crm-text-tertiary)]">{row.admin_id.slice(0, 8)}…</span>
                      )}
                    </td>
                    <td className={`${TD_CLASS} text-[12px]`}>
                      {row.entity_type ? (
                        <>
                          <span>{row.entity_type}</span>
                          {row.entity_id && (
                            <code className="ml-1 text-[11px] text-[var(--crm-text-tertiary)]">
                              {row.entity_id.slice(0, 8)}…
                            </code>
                          )}
                        </>
                      ) : (
                        <span className="text-[var(--crm-text-tertiary)]">—</span>
                      )}
                    </td>
                    <td className={`${TD_CLASS} font-[family-name:var(--font-mono)] text-[11px] text-[var(--crm-text-tertiary)]`}>
                      {row.ip_address ?? '—'}
                    </td>
                    <td className={`${TD_CLASS} text-[12px] tabular-nums text-[var(--crm-text-tertiary)]`}>
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

function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone?: Tone;
  testId: string;
}) {
  return (
    <div
      className="rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] p-4"
      style={tone ? { borderColor: `var(--crm-${tone}-subtle)`, backgroundColor: `var(--crm-${tone}-subtle)` } : undefined}
      data-testid={testId}
    >
      <Icon
        className="h-5 w-5"
        style={{ color: tone ? `var(--crm-${tone})` : 'var(--crm-text-tertiary)' }}
        strokeWidth={1.75}
      />
      <div className="mt-3 text-[22px] font-medium leading-7 tabular-nums text-[var(--crm-text-primary)]">
        {formatNumber(value)}
      </div>
      <div className="mt-0.5 text-[12px] text-[var(--crm-text-tertiary)]">{label}</div>
    </div>
  );
}

function DependencyCard({ dep }: { dep: DependencyStatus }) {
  const map: Record<DependencyStatus['status'], { tone: Tone; icon: LucideIcon; label: string }> = {
    healthy: { tone: 'success', icon: CheckCircle2, label: 'Healthy' },
    degraded: { tone: 'danger', icon: XCircle, label: 'Degraded' },
    unknown: { tone: 'neutral', icon: HelpCircle, label: 'Unknown' },
  };
  const cfg = map[dep.status];
  const Icon = cfg.icon;
  return (
    <div className="rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] p-4">
      <Badge tone={cfg.tone} size="sm">
        <Icon className="h-3 w-3" /> {cfg.label}
      </Badge>
      <div className="mt-3 text-[13px] font-medium text-[var(--crm-text-primary)]">{dep.label}</div>
      <div className="mt-0.5 text-[12px] text-[var(--crm-text-tertiary)]">{dep.detail}</div>
      <div className="mt-1 text-[11px] text-[var(--crm-text-tertiary)]">
        Checked {new Date(dep.checked_at).toLocaleTimeString()}
      </div>
    </div>
  );
}

function CronRow({ job }: { job: CronJobRun }) {
  const tone: Tone =
    job.status === 'COMPLETED' ? 'success' : job.status === 'FAILED' ? 'danger' : 'info';
  return (
    <tr className="border-b border-[var(--crm-border)] crm-hairline last:border-b-0">
      <td className={TD_CLASS}>
        <code className="text-[12px] text-[var(--crm-primary)]">{job.cron_name}</code>
        {job.error && (
          <div className="mt-0.5 text-[11px] text-[var(--crm-danger)]">{job.error.slice(0, 120)}</div>
        )}
        {job.overdue && (
          <div className="mt-0.5 text-[11px] text-[var(--crm-danger)]">
            Overdue — no run within the expected window
            {job.max_age_minutes ? ` (${job.max_age_minutes}m)` : ''}
          </div>
        )}
      </td>
      <td className={TD_CLASS}>
        <div className="flex items-center gap-1.5">
          <Badge tone={tone} size="sm">
            {job.status}
          </Badge>
          {job.overdue && (
            <Badge tone="danger" size="sm">
              Overdue
            </Badge>
          )}
        </div>
      </td>
      <td className={`${TD_CLASS} text-[12px] tabular-nums text-[var(--crm-text-tertiary)]`}>
        {job.duration != null ? `${job.duration}ms` : '—'}
      </td>
      <td className={`${TD_CLASS} text-[12px] tabular-nums text-[var(--crm-text-tertiary)]`}>
        {relativeTime(job.started_at)}
      </td>
    </tr>
  );
}
