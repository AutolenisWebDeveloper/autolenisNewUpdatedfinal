import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { OperationsService } from '@/lib/services/operations.service';

export const dynamic = 'force-dynamic';

// Re-emit a dead-lettered Inngest job and remove the DLQ row on success.
// Idempotency on the underlying job (see emailSendFn / smsSendFn) suppresses
// a duplicate send if the original message had quietly succeeded.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ops = new OperationsService(getServiceSupabase());
  const result = await ops.retryDeadLetterJob(id);
  if (!result.retried) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
