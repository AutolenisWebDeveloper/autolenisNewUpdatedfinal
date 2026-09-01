import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { OperationsService } from '@/lib/services/operations.service';
import { requirePermissionActorStrict } from '@/lib/auth/permissions';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';

export const dynamic = 'force-dynamic';

// Re-emit a dead-lettered Inngest job and remove the DLQ row on success.
// Idempotency on the underlying job (see emailSendFn / smsSendFn) suppresses
// a duplicate send if the original message had quietly succeeded.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // Enforced directly (not via the shadow flag): replaying a dead-lettered job
  // re-fires its arbitrary inherited side effects, so this is SUPER_ADMIN only.
  // It previously had no role check, leaving it open to every authenticated admin.
  const actorCheck = await requirePermissionActorStrict("ops.replay", { path: `/api/admin/operations/dlq/${id}/retry`, method: 'POST' });
  if (!actorCheck.ok) return NextResponse.json({ error: actorCheck.code }, { status: actorCheck.status });
  const actor = actorCheck.actor;
  const supabase = getServiceSupabase();
  const ops = new OperationsService(supabase);

  let result: { retried: boolean };
  try {
    result = await ops.retryDeadLetterJob(id);
  } catch {
    return NextResponse.json({ error: 'RETRY_FAILED' }, { status: 502 });
  }
  if (!result.retried) {
    // Already claimed by a prior retry, or never existed — safe no-op.
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  await writeCrmAuditLog(supabase, actor, {
    action: 'OPERATIONS_DLQ_RETRY',
    entity_type: 'dlq_job',
    entity_id: id,
  });
  return NextResponse.json({ ok: true });
}
