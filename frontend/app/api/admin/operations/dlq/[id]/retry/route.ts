import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { OperationsService } from '@/lib/services/operations.service';
import { requirePermissionActor } from '@/lib/auth/permissions';
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
  const actor = await requirePermissionActor("crm.manage");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
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
