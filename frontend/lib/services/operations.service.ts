import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/stripe';
import { detectDeadCrons } from './monitoring/dead-cron.service';

// Raised when a dead-letter row names an event with NO internal owner. Inngest is
// fully removed, so there is no fallback dispatcher: rather than silently dropping
// the row or resurrecting a vendor, the caller catches this and marks the row
// TERMINAL (observable, bounded, never retried, never re-emitted anywhere).
export class UnroutableDeadLetterError extends Error {
  constructor(public readonly eventName: string) {
    super(`no internal owner for dead-letter event "${eventName}" — not re-emitted`);
    this.name = 'UnroutableDeadLetterError';
  }
}

// Default ceiling for automated DLQ re-drives. Shared so the drainer and the
// health read agree on what "terminal" means: a row whose auto_retry_count has
// reached this cap is no longer auto-retried and needs human review.
export const DEFAULT_MAX_AUTO_RETRIES = 3;

// Re-drive a NON-QStash dead-letter row to its current owner. Every migrated event
// name routes to its internal replacement (transport-neutral terminal/replay) — the
// DLQ replay path must NEVER resurrect a retired worker's events:
//   autolenis/email.send + sms.send          → the comms outbox (enqueue-once)
//   autolenis/dealer.award                    → emitDealerAwardOutcomes (idempotent)
//   autolenis/lead.form_abandoned             → scheduleLeadNurture('form_abandonment')
//   autolenis/lead.exit_intent_captured       → scheduleLeadNurture('exit_intent')
//   autolenis/affiliate.commission_walk       → processFeeCommission (idempotent on
//                                               qualifyingEventId) — the durable
//                                               recovery path for a commission walk
//                                               that failed after the fee PI paid.
// These had a durable/idempotent entry point, so replaying a row is safe and
// idempotent. Every OTHER workload recovers from its own durable DB state via its
// cron (campaign status, workflow_enrollments.resume_at, ContentGenerationJobItem
// status, buyer_opportunities.intake_failed_at) and writes NOTHING to
// jobs_dead_letter — so an unrecognized event here is a vestige with no internal
// consumer and is terminalized (UnroutableDeadLetterError), never sent onward.
async function reemitDeadLetterJob(
  eventName: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (eventName === 'autolenis/email.send') {
    const { enqueueEmail } = await import('@/lib/services/comms/comms-outbox.service');
    await enqueueEmail(payload as never);
    return;
  }
  if (eventName === 'autolenis/sms.send') {
    const { enqueueSms } = await import('@/lib/services/comms/comms-outbox.service');
    await enqueueSms(payload as never);
    return;
  }
  if (eventName === 'autolenis/dealer.award') {
    // Re-drive via the internal (idempotent) dispatcher, not the deleted worker.
    const { emitDealerAwardOutcomes } = await import('@/lib/services/notifications/dealer-award');
    await emitDealerAwardOutcomes(
      payload as { auctionId: string; winningOfferId: string; dealId: string },
    );
    return;
  }
  if (
    eventName === 'autolenis/lead.form_abandoned' ||
    eventName === 'autolenis/lead.exit_intent_captured'
  ) {
    // Re-drive the LP lead-nurture sequence via the internal durable scheduler,
    // not the deleted formAbandonmentFn / exitIntentFn Inngest workers. The
    // dead-letter payload carries the original Inngest event shape (snake_case);
    // scheduleLeadNurture is idempotent on (idempotency_key, step) so a replay
    // of an already-scheduled sequence adds no duplicate touch.
    const { scheduleLeadNurture } = await import('@/lib/services/crm/lead-nurture.service');
    const sequence =
      eventName === 'autolenis/lead.form_abandoned' ? 'form_abandonment' : 'exit_intent';
    await scheduleLeadNurture(sequence, {
      contactId:      String(payload.contact_id ?? ''),
      contactEmail:   String(payload.contact_email ?? ''),
      firstName:      (payload.first_name as string | null) ?? null,
      campaign:       (payload.campaign as string | null) ?? null,
      idempotencyKey: String(payload.idempotency_key ?? ''),
    });
    return;
  }
  if (eventName === 'autolenis/affiliate.commission_walk') {
    // Durable recovery for a commission walk that failed in the Stripe fee webhook
    // after the fee PaymentIntent was captured. processFeeCommission re-runs the
    // whole buyer→referral→walk chain and is idempotent on qualifyingEventId
    // (`${eventId}-L${level}`), so replaying it — including after a partial success —
    // never double-pays.
    const dealId = String(payload.dealId ?? '');
    const buyerId = String(payload.buyerId ?? '');
    const qualifyingEventId = String(payload.qualifyingEventId ?? '');
    if (!dealId || !buyerId || !qualifyingEventId) {
      // A malformed row can never produce a valid commission — terminalize it
      // rather than writing garbage or looping.
      throw new UnroutableDeadLetterError(eventName);
    }
    const feeBasisCents =
      typeof payload.feeBasisCents === 'number' ? payload.feeBasisCents : undefined;
    const { processFeeCommission } = await import('@/lib/services/affiliate/commission.service');
    await processFeeCommission({ dealId, buyerId, qualifyingEventId, feeBasisCents });
    return;
  }
  // No internal owner and no vendor fallback (Inngest removed). Signal the caller
  // to terminalize this row rather than dropping it or dispatching it anywhere.
  throw new UnroutableDeadLetterError(eventName);
}

// ----------------------------------------------------------------------------
// AutoLenis Phase 5 — Operations dashboard data layer.
//
// Surfaces the four operational visibility panels:
//   1. System health  (counts + last refresh)
//   2. Job dead-letter queue (failed automation jobs, retry one-by-one)
//   3. Failed workflow enrollments (engine-level failures)
//   4. Admin audit log (last N admin mutations)
//
// All reads use the service-role Supabase client — the route that invokes
// this service is itself behind admin session validation, so RLS bypass is
// intentional.
// ----------------------------------------------------------------------------

export interface SystemHealth {
  dead_letter_count: number;
  // DLQ rows still under the auto-retry cap — transient failures the drainer is
  // actively re-driving. These are what the overall `status` escalates on.
  retryable_dead_letter_count: number;
  // DLQ rows that reached the auto-retry cap: no longer auto-retried, they need a
  // human. Surfaced as a distinct signal so they never masquerade as transient
  // backlog, and — critically — so a pile of permanently-stuck rows can no longer
  // pin `status` at 'critical' forever and drown out fresh, actionable failures.
  terminal_dead_letter_count: number;
  failed_enrollments_count: number;
  active_enrollments_count: number;
  pending_idempotency_count: number;
  last_analytics_refresh_at: string | null;
  status: 'ok' | 'degraded' | 'critical';
}

export type DependencyState = 'healthy' | 'degraded' | 'unknown';

export interface DependencyStatus {
  key: string;
  label: string;
  status: DependencyState;
  detail: string;
  checked_at: string;
}

export interface CronJobRun {
  id: string;
  cron_name: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | string;
  duration: number | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  // D3a — dead-cron annotation from the CRON_STALENESS registry. `overdue` means
  // the most recent run is older than the cron's expected cadence (it should have
  // run again by now). null max_age_minutes = the cron is not staleness-monitored.
  overdue: boolean;
  max_age_minutes: number | null;
}

export interface DeadLetterJob {
  id: string;
  job_id: string;
  event_name: string;
  payload: Record<string, unknown>;
  error_message: string;
  failed_at: string;
}

export interface FailedEnrollment {
  id: string;
  workflow_id: string;
  contact_id: string;
  workflow_name: string;
  contact_email: string | null;
  status: 'exited' | 'failed';
  exit_reason: string | null;
  enrolled_at: string;
  exited_at: string | null;
}

export interface AuditLogEntry {
  id: string;
  admin_id: string;
  admin_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  ip_address: string | null;
  created_at: string;
}

export class OperationsService {
  constructor(private supabase: SupabaseClient) {}

  // ────────────────────────────────────────────────────────────────────────
  // SYSTEM HEALTH
  // ────────────────────────────────────────────────────────────────────────
  async getHealth(): Promise<SystemHealth> {
    const [dlqRes, terminalDlqRes, failedRes, activeRes, pendingIdemRes, refreshRes] = await Promise.all([
      this.supabase
        .from('jobs_dead_letter')
        .select('id', { count: 'exact', head: true }),
      // Terminal rows: auto_retry_count has reached the cap, so the drainer will
      // never touch them again. Counted separately so live (retryable) backlog
      // drives the status while terminal rows are surfaced without pinning it.
      this.supabase
        .from('jobs_dead_letter')
        .select('id', { count: 'exact', head: true })
        .gte('auto_retry_count', DEFAULT_MAX_AUTO_RETRIES),
      this.supabase
        .from('workflow_enrollments')
        .select('id', { count: 'exact', head: true })
        .in('status', ['failed', 'exited']),
      this.supabase
        .from('workflow_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active'),
      this.supabase
        .from('idempotency_keys')
        .select('key_hash', { count: 'exact', head: true })
        .eq('execution_status', 'processing'),
      // Last successful matview refresh — surfaced via the matview's most
      // recent day. No persistent log table is kept (REFRESH is idempotent).
      this.supabase
        .from('mv_funnel_metrics')
        .select('day')
        .order('day', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const dlqTotal = dlqRes.count ?? 0;
    const terminal = terminalDlqRes.count ?? 0;
    // Rows below the cap the drainer is still re-driving. Guard against a negative
    // if the two head-count queries race a concurrent insert/terminalize.
    const retryable = Math.max(0, dlqTotal - terminal);
    const failed = failedRes.count ?? 0;
    const active = activeRes.count ?? 0;
    const pendingIdem = pendingIdemRes.count ?? 0;

    // Escalate on the ACTIONABLE-by-system signal (live retryable backlog + failed
    // enrollments), never on terminal rows alone — those are bounded and need a
    // human, so they hold 'degraded' (visible) but can no longer force 'critical'
    // in perpetuity, which was drowning fresh failures in the ops banner.
    let status: 'ok' | 'degraded' | 'critical' = 'ok';
    if (retryable >= 25 || failed >= 25) status = 'critical';
    else if (retryable > 0 || failed > 0 || terminal > 0) status = 'degraded';

    return {
      dead_letter_count: dlqTotal,
      retryable_dead_letter_count: retryable,
      terminal_dead_letter_count: terminal,
      failed_enrollments_count: failed,
      active_enrollments_count: active,
      pending_idempotency_count: pendingIdem,
      last_analytics_refresh_at: refreshRes.data?.day
        ? new Date(refreshRes.data.day).toISOString()
        : null,
      status,
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // DEPENDENCY HEALTH — live status of every external platform dependency.
  //
  // Live-pingable services (Supabase, Stripe) are reached with a short timeout
  // and report healthy/degraded. Credential-gated services with no cheap ping
  // (Resend, Twilio, DocuSign) report healthy when configured and `unknown`
  // when their credentials are absent — we cannot confirm reachability without
  // a billable call. Automated-job execution is the internal Vercel-Cron
  // substrate, monitored separately by the cron liveness / dead-cron detector.
  // ────────────────────────────────────────────────────────────────────────
  async getDependencyHealth(): Promise<DependencyStatus[]> {
    const checked_at = new Date().toISOString();

    const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), ms),
      );
      return Promise.race([p, timeout]);
    };

    const supabaseCheck = async (): Promise<DependencyStatus> => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) {
        return { key: 'supabase', label: 'Supabase', status: 'unknown', detail: 'Not configured', checked_at };
      }
      try {
        const res = await fetch(`${url}/rest/v1/`, {
          headers: { apikey: key },
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
        return { key: 'supabase', label: 'Supabase', status: 'healthy', detail: 'REST API reachable', checked_at };
      } catch {
        return { key: 'supabase', label: 'Supabase', status: 'degraded', detail: 'Unreachable', checked_at };
      }
    };

    const stripeCheck = async (): Promise<DependencyStatus> => {
      if (!process.env.STRIPE_SECRET_KEY) {
        return { key: 'stripe', label: 'Stripe', status: 'unknown', detail: 'Not configured', checked_at };
      }
      try {
        await withTimeout(getStripe().balance.retrieve(), 3000);
        return { key: 'stripe', label: 'Stripe', status: 'healthy', detail: 'API reachable', checked_at };
      } catch {
        return { key: 'stripe', label: 'Stripe', status: 'degraded', detail: 'API key invalid or unreachable', checked_at };
      }
    };

    const credentialCheck = (
      key: string,
      label: string,
      vars: string[],
    ): DependencyStatus => {
      const ok = vars.every((v) => !!process.env[v]);
      return ok
        ? { key, label, status: 'healthy', detail: 'Configured', checked_at }
        : { key, label, status: 'unknown', detail: 'Credentials not set', checked_at };
    };

    // Inngest is fully removed — it is no longer a dependency and no longer appears
    // in the health panel. Automated-job execution is now the internal Vercel-Cron
    // substrate, surfaced separately by the cron liveness / dead-cron monitor.
    const [supabase, stripe] = await Promise.all([supabaseCheck(), stripeCheck()]);

    return [
      supabase,
      stripe,
      credentialCheck('resend', 'Resend', ['RESEND_API_KEY']),
      credentialCheck('twilio', 'Twilio', ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']),
      credentialCheck('docusign', 'DocuSign', ['DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_ACCOUNT_ID']),
    ];
  }

  // ────────────────────────────────────────────────────────────────────────
  // CRON JOB STATUS — latest run per cron from cron_job_logs.
  // ────────────────────────────────────────────────────────────────────────
  async listCronJobs(limit = 200): Promise<CronJobRun[]> {
    const { data } = await this.supabase
      .from('cron_job_logs')
      .select('id,cron_name,status,duration,error,started_at,completed_at')
      .order('started_at', { ascending: false })
      .limit(limit);

    const rows = (data ?? []) as Array<{
      id: string;
      cron_name: string;
      status: string;
      duration: number | null;
      error: string | null;
      started_at: string;
      completed_at: string | null;
    }>;

    // Collapse to the most recent run per cron name (rows already DESC by time).
    const latest = new Map<string, CronJobRun>();
    for (const row of rows) {
      if (latest.has(row.cron_name)) continue;
      latest.set(row.cron_name, {
        id: row.id,
        cron_name: row.cron_name,
        status: row.status,
        duration: row.duration,
        error: row.error,
        started_at: row.started_at,
        completed_at: row.completed_at,
        overdue: false,
        max_age_minutes: null,
      });
    }

    // Authoritative dead-cron liveness comes from an UNBOUNDED groupBy (latest run
    // per cron across all rows), not this recent-row window: a cron dead long
    // enough for its last row to fall past the `limit` would otherwise vanish from
    // the widget instead of showing Overdue — exactly the case this panel exists to
    // surface. Override in-window rows, and add a synthetic row for any overdue cron
    // whose last run is outside the window so it still appears.
    for (const l of await detectDeadCrons()) {
      if (l.state !== 'OVERDUE') continue;
      const existing = latest.get(l.cronName);
      if (existing) {
        existing.overdue = true;
        existing.max_age_minutes = l.maxAgeMinutes;
      } else {
        latest.set(l.cronName, {
          id: `stale:${l.cronName}`,
          cron_name: l.cronName,
          status: 'STALE',
          duration: null,
          error: null,
          started_at: l.lastRunAt ? l.lastRunAt.toISOString() : new Date(0).toISOString(),
          completed_at: null,
          overdue: true,
          max_age_minutes: l.maxAgeMinutes,
        });
      }
    }

    return [...latest.values()].sort((a, b) => a.cron_name.localeCompare(b.cron_name));
  }

  // ────────────────────────────────────────────────────────────────────────
  // DEAD LETTER QUEUE
  // ────────────────────────────────────────────────────────────────────────
  async listDeadLetterJobs(limit = 100): Promise<DeadLetterJob[]> {
    const { data } = await this.supabase
      .from('jobs_dead_letter')
      .select('id,job_id,event_name,payload,error_message,failed_at')
      .order('failed_at', { ascending: false })
      .limit(limit);

    return (data ?? []).map((row) => ({
      id: String(row.id),
      job_id: String(row.job_id),
      event_name: String(row.event_name),
      payload: (row.payload ?? {}) as Record<string, unknown>,
      error_message: String(row.error_message),
      failed_at: String(row.failed_at),
    }));
  }

  // Re-drive a dead-letter job to its internal owner. Idempotency is enforced by
  // claiming the row with a conditional delete BEFORE re-driving: only the caller
  // whose delete actually removed the row proceeds, so a double retry (two
  // concurrent clicks, or a retried request) re-drives at most once. The
  // underlying job's own idempotency guard is a second line of defence. If the
  // re-drive fails after the claim, the row is restored so it can be retried.
  async retryDeadLetterJob(id: string): Promise<{ retried: boolean }> {
    const { data: claimed, error: claimErr } = await this.supabase
      .from('jobs_dead_letter')
      .delete()
      .eq('id', id)
      .select('id,job_id,event_name,payload,error_message,failed_at');

    if (claimErr || !claimed || claimed.length === 0) return { retried: false };
    const row = claimed[0] as {
      id: string;
      job_id: string;
      event_name: string;
      payload: Record<string, unknown> | null;
      error_message: string;
      failed_at: string;
    };

    try {
      await reemitDeadLetterJob(row.event_name, (row.payload ?? {}) as Record<string, unknown>);
    } catch (err) {
      // An unroutable event has no internal owner — restore the row with a
      // sanitized terminal reason and report not-retried (never re-emit anywhere).
      const unroutable = err instanceof UnroutableDeadLetterError;
      await this.supabase.from('jobs_dead_letter').insert({
        id: row.id,
        job_id: row.job_id,
        event_name: row.event_name,
        payload: row.payload ?? {},
        error_message: unroutable
          ? `TERMINAL — no internal owner for "${row.event_name}" (not re-emitted)`
          : row.error_message,
        failed_at: row.failed_at,
      });
      if (unroutable) return { retried: false };
      // Transient failure — restore + surface so it can be retried again.
      throw err instanceof Error ? err : new Error('DLQ re-drive failed');
    }

    return { retried: true };
  }

  // F-035 — automated DLQ drainer. Re-emits eligible dead-letter rows without a
  // human clicking Retry, bounded so a poison job cannot hot-loop:
  //   • only rows older than `minAgeMs` (transient blips get a chance to clear),
  //   • only rows under `maxAutoRetries` (else left for manual review),
  //   • a per-run batch cap.
  // QStash-origin rows (event_name "qstash:<path>") are re-published through
  // QStash; everything else is re-driven to its internal owner (or terminalized
  // when no owner exists — Inngest is gone, nothing is ever re-emitted to it). The
  // attempt counter is incremented BEFORE re-drive (claim), so a crash mid-drain
  // can never cause an unbounded loop. The underlying jobs are idempotency-guarded.
  async autoDrainDeadLetterJobs(opts?: {
    maxAutoRetries?: number;
    minAgeMs?: number;
    batch?: number;
  }): Promise<{ scanned: number; reemitted: number; skipped: number; failed: number }> {
    const maxAutoRetries = opts?.maxAutoRetries ?? DEFAULT_MAX_AUTO_RETRIES;
    const minAgeMs = opts?.minAgeMs ?? 10 * 60_000;
    const batch = opts?.batch ?? 25;
    const cutoff = new Date(Date.now() - minAgeMs).toISOString();

    const { data } = await this.supabase
      .from('jobs_dead_letter')
      .select('id,job_id,event_name,payload,auto_retry_count')
      .lt('auto_retry_count', maxAutoRetries)
      .lt('failed_at', cutoff)
      .order('failed_at', { ascending: true })
      .limit(batch);

    const rows = (data ?? []) as Array<{
      id: string;
      job_id: string;
      event_name: string;
      payload: Record<string, unknown> | null;
      auto_retry_count: number;
    }>;

    let reemitted = 0;
    let failed = 0;
    for (const row of rows) {
      // Claim: bump the counter first so a re-emit that itself re-dead-letters
      // (or a mid-loop crash) cannot retry this row beyond the cap.
      const { data: claimed } = await this.supabase
        .from('jobs_dead_letter')
        .update({ auto_retry_count: row.auto_retry_count + 1 })
        .eq('id', row.id)
        .eq('auto_retry_count', row.auto_retry_count)
        .select('id');
      if (!claimed || claimed.length === 0) continue; // another run claimed it

      try {
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        if (row.event_name.startsWith('qstash:')) {
          // Re-publish the original QStash job. Payload carries { path, body, ... }.
          const { dispatch } = await import('@/lib/qstash/dispatch');
          await dispatch({
            path: String(payload.path ?? ''),
            body: (payload.body ?? {}) as Record<string, unknown>,
          });
        } else {
          await reemitDeadLetterJob(row.event_name, payload);
        }
        // Success — remove the row.
        await this.supabase.from('jobs_dead_letter').delete().eq('id', row.id);
        reemitted += 1;
      } catch (err) {
        if (err instanceof UnroutableDeadLetterError) {
          // No internal owner: terminalize NOW (pin auto_retry_count at the cap so
          // it's excluded from every future scan) with a sanitized diagnostic. The
          // row is kept for operator visibility — never re-driven, never re-emitted.
          await this.supabase
            .from('jobs_dead_letter')
            .update({
              auto_retry_count: maxAutoRetries,
              error_message: `TERMINAL — no internal owner for "${row.event_name}" (not re-emitted)`,
            })
            .eq('id', row.id);
        }
        // Transient failure: leave the row (counter already incremented) for the
        // next pass / manual review. Either way, bounded — never a hot loop.
        failed += 1;
      }
    }

    return {
      scanned: rows.length,
      reemitted,
      skipped: rows.length - reemitted - failed,
      failed,
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // FAILED WORKFLOW ENROLLMENTS
  // ────────────────────────────────────────────────────────────────────────
  async listFailedEnrollments(limit = 100): Promise<FailedEnrollment[]> {
    const { data } = await this.supabase
      .from('workflow_enrollments')
      .select(
        'id,workflow_id,contact_id,status,exit_reason,enrolled_at,exited_at,workflow:workflows(name),contact:contacts(email)'
      )
      .in('status', ['failed', 'exited'])
      .order('exited_at', { ascending: false, nullsFirst: false })
      .limit(limit);

    type Row = {
      id: string;
      workflow_id: string;
      contact_id: string;
      status: 'failed' | 'exited';
      exit_reason: string | null;
      enrolled_at: string;
      exited_at: string | null;
      workflow:
        | { name: string | null }
        | { name: string | null }[]
        | null;
      contact:
        | { email: string | null }
        | { email: string | null }[]
        | null;
    };

    return ((data ?? []) as unknown as Row[]).map((row) => {
      const wf = Array.isArray(row.workflow) ? row.workflow[0] : row.workflow;
      const ct = Array.isArray(row.contact) ? row.contact[0] : row.contact;
      return {
        id: row.id,
        workflow_id: row.workflow_id,
        contact_id: row.contact_id,
        workflow_name: wf?.name ?? 'Unknown',
        contact_email: ct?.email ?? null,
        status: row.status,
        exit_reason: row.exit_reason,
        enrolled_at: row.enrolled_at,
        exited_at: row.exited_at,
      };
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // ADMIN AUDIT LOG
  // ────────────────────────────────────────────────────────────────────────
  // Last `limit` admin mutations, optionally filtered by free-text search
  // against action / entity_type. The admin's email is resolved from the
  // CRM-internal admins lookup table that already powers conversation
  // assignment — keeps the audit feed readable without a Prisma round-trip.
  async listAuditLog(options: {
    limit?: number;
    query?: string;
  } = {}): Promise<AuditLogEntry[]> {
    const limit = Math.min(500, Math.max(10, options.limit ?? 200));
    let query = this.supabase
      .from('admin_audit_logs')
      .select('id,admin_id,admin_email,action,entity_type,entity_id,ip_address,created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (options.query) {
      const like = `%${options.query.replace(/[%_]/g, (m) => `\\${m}`)}%`;
      query = query.or(`action.ilike.${like},entity_type.ilike.${like}`);
    }

    const { data } = await query;
    const rows = (data ?? []) as Array<{
      id: string;
      admin_id: string;
      admin_email: string | null;
      action: string;
      entity_type: string | null;
      entity_id: string | null;
      ip_address: string | null;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      admin_id: row.admin_id,
      admin_email: row.admin_email,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      ip_address: row.ip_address,
      created_at: row.created_at,
    }));
  }
}
