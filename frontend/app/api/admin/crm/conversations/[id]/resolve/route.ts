import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { requirePermissionActor } from '@/lib/auth/permissions';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actor = await requirePermissionActor("crm.manage");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const supabase = getServiceSupabase();

  const { data: before } = await supabase
    .from('conversations')
    .select('status')
    .eq('id', id)
    .maybeSingle();

  const { error } = await supabase
    .from('conversations')
    .update({ status: 'resolved', updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeCrmAuditLog(supabase, actor, {
    action: 'RESOLVE_CONVERSATION',
    entity_type: 'conversation',
    entity_id: id,
    previous_state: { status: before?.status ?? null },
    new_state: { status: 'resolved' },
  });

  return NextResponse.json({ ok: true });
}
