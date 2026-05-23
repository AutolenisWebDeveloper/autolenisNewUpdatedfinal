import type { SupabaseClient } from '@supabase/supabase-js';

export interface CrmAuditActor {
  adminId: string;
  adminEmail: string;
}

export interface CrmAuditInput {
  action: string;
  entity_type: string;
  entity_id?: string | null;
  previous_state?: unknown;
  new_state?: unknown;
  reason?: string;
  metadata?: Record<string, unknown>;
}

// Writes an admin audit-log row from CRM services. Targets the canonical
// `admin_audit_logs` table (plural) — the same table the rest of the platform
// writes to via Prisma. The Supabase service-role client is used so service
// callers do not need their own Prisma instance.
//
// `actor` may be null only in non-admin contexts (system-initiated CRM jobs);
// in that case the write is skipped because admin_audit_logs.admin_id and
// admin_email are NOT NULL.
export async function writeCrmAuditLog(
  supabase: SupabaseClient,
  actor: CrmAuditActor | null,
  input: CrmAuditInput,
): Promise<void> {
  if (!actor) return;
  await supabase.from('admin_audit_logs').insert({
    admin_id: actor.adminId,
    admin_email: actor.adminEmail,
    action: input.action,
    entity_type: input.entity_type,
    entity_id: input.entity_id ?? '',
    reason: input.reason ?? null,
    metadata: input.metadata ?? null,
    previous_state: input.previous_state ?? null,
    new_state: input.new_state ?? null,
  });
}
