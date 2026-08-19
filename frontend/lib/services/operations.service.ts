import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inngest } from '@/lib/inngest/client';
import { inngestFunctions } from '@/lib/inngest/functions';
import { getStripe } from '@/lib/stripe';
import { classifyCronLiveness } from './monitoring/cron-schedule';

// ----------------------------------------------------------------------------
// AutoLenis Phase 5 — Operations dashboard data layer.
//
// Surfaces the four operational visibility panels:
//   1. System health  (counts + last refresh)
//   2. Dead letter queue (failed Inngest jobs, retry one-by-one)
//   3. Failed workflow enrollments (engine-level failures)
//   4. Admin audit log (last N admin mutations)
//
// All reads use the service-role Supabase client — the route that invokes
// this service is itself behind admin session validation, so RLS bypass is
// intentional.
// ----------------------------------------------------------------------------

export interface SystemHealth {
  dead_letter_count: number;
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
    const [dlqRes, failedRes, activeRes, pendingIdemRes, refreshRes] = await Promise.all([
      this.supabase
        .from('jobs_dead_letter')
        .select('id', { count: 'exact', head: true }),
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

    const dlq = dlqRes.count ?? 0;
    const failed = failedRes.count ?? 0;
    const active = activeRes.count ?? 0;
    const pendingIdem = pendingIdemRes.count ?? 0;

    let status: 'ok' | 'degraded' | 'critical' = 'ok';
    if (dlq >= 25 || failed >= 25) status = 'critical';
    else if (dlq > 0 || failed > 0) status = 'degraded';

    return {
      dead_letter_count: dlq,
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
  // a billable call. Inngest reports healthy when functions are registered with
  // the serve handler.
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

    const inngestCheck = (): DependencyStatus => {
      const count = inngestFunctions.length;
      return count > 0
        ? { key: 'inngest', label: 'Inngest', status: 'healthy', detail: `${count} functions registered`, checked_at }
        : { key: 'inngest', label: 'Inngest', status: 'degraded', detail: 'No functions registered', checked_at };
    };

    const [supabase, stripe] = await Promise.all([supabaseCheck(), stripeCheck()]);

    return [
      supabase,
      stripe,
      credentialCheck('resend', 'Resend', ['RESEND_API_KEY']),
      credentialCheck('twilio', 'Twilio', ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']),
      credentialCheck('docusign', 'DocuSign', ['DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_ACCOUNT_ID']),
      inngestCheck(),
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

    // Collapse to the most recent run per cron name (rows already DESC by time),
    // then annotate each with dead-cron liveness from the CRON_STALENESS registry.
    const now = new Date();
    const latest = new Map<string, CronJobRun>();
    for (const row of rows) {
      if (latest.has(row.cron_name)) continue;
      const liveness = classifyCronLiveness(row.cron_name, new Date(row.started_at), now);
      latest.set(row.cron_name, {
        id: row.id,
        cron_name: row.cron_name,
        status: row.status,
        duration: row.duration,
        error: row.error,
        started_at: row.started_at,
        completed_at: row.completed_at,
        overdue: liveness.state === 'OVERDUE',
        max_age_minutes: liveness.maxAgeMinutes || null,
      });
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

  // Re-emit a dead-letter job via Inngest. Idempotency is enforced by claiming
  // the row with a conditional delete BEFORE dispatching: only the caller whose
  // delete actually removed the row proceeds to re-emit, so a double retry (two
  // concurrent clicks, or a retried request) dispatches at most once. The
  // underlying job's own idempotency guard is a second line of defence. If the
  // re-emit fails after the claim, the row is restored so it can be retried.
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
      await inngest.send({
        name: row.event_name,
        data: (row.payload ?? {}) as Record<string, unknown>,
      });
    } catch (err) {
      // Re-emit failed — put the row back so the job is not silently lost.
      await this.supabase.from('jobs_dead_letter').insert({
        id: row.id,
        job_id: row.job_id,
        event_name: row.event_name,
        payload: row.payload ?? {},
        error_message: row.error_message,
        failed_at: row.failed_at,
      });
      throw err instanceof Error ? err : new Error('DLQ re-emit failed');
    }

    return { retried: true };
  }

  // F-035 — automated DLQ drainer. Re-emits eligible dead-letter rows without a
  // human clicking Retry, bounded so a poison job cannot hot-loop:
  //   • only rows older than `minAgeMs` (transient blips get a chance to clear),
  //   • only rows under `maxAutoRetries` (else left for manual review),
  //   • a per-run batch cap.
  // QStash-origin rows (event_name "qstash:<path>") are re-published through
  // QStash; everything else is re-emitted through Inngest. The attempt counter
  // is incremented BEFORE re-emit (claim), so a crash mid-drain can never cause
  // an unbounded loop. The underlying jobs are themselves idempotency-guarded.
  async autoDrainDeadLetterJobs(opts?: {
    maxAutoRetries?: number;
    minAgeMs?: number;
    batch?: number;
  }): Promise<{ scanned: number; reemitted: number; skipped: number; failed: number }> {
    const maxAutoRetries = opts?.maxAutoRetries ?? 3;
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
          await inngest.send({ name: row.event_name, data: payload });
        }
        // Success — remove the row.
        await this.supabase.from('jobs_dead_letter').delete().eq('id', row.id);
        reemitted += 1;
      } catch {
        // Leave the row (counter already incremented) for the next pass / manual review.
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
