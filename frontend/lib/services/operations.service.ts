import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inngest } from '@/lib/inngest/client';

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

  // Re-emit a dead-letter job via Inngest and remove the DLQ row. The retry
  // path goes back through the normal job's idempotency guard, so duplicate
  // dispatch is naturally suppressed if the original message actually did
  // succeed and was misfiled.
  async retryDeadLetterJob(id: string): Promise<{ retried: boolean }> {
    const { data: row, error: readErr } = await this.supabase
      .from('jobs_dead_letter')
      .select('event_name,payload')
      .eq('id', id)
      .maybeSingle();

    if (readErr || !row) return { retried: false };

    await inngest.send({
      name: row.event_name,
      data: (row.payload ?? {}) as Record<string, unknown>,
    });

    await this.supabase.from('jobs_dead_letter').delete().eq('id', id);
    return { retried: true };
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
