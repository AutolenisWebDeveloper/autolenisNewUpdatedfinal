import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { getAdminActor } from '@/lib/auth/admin-actor';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';

export const dynamic = 'force-dynamic';

const VALID_STATUSES = ['open', 'in_progress', 'completed', 'deferred'] as const;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actor = await getAdminActor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const body = (await req.json()) as {
    status?: string;
    completed_at?: string | null;
    assigned_to?: string | null;
  };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.status) {
    if (!(VALID_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.assigned_to !== undefined) patch.assigned_to = body.assigned_to;

  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from('crm_tasks')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'NOT_FOUND' }, { status: 404 });
  }

  if (body.status === 'completed' && data.contact_id) {
    await supabase.from('contact_timeline_events').insert({
      contact_id: data.contact_id,
      event_type: 'task_completed',
      event_data: { task_id: data.id, title: data.title },
    });
  }

  await writeCrmAuditLog(supabase, actor, {
    action: 'CRM_TASK_UPDATED',
    entity_type: 'crm_task',
    entity_id: id,
    new_state: data,
    metadata: { fields_changed: Object.keys(patch).filter((k) => k !== 'updated_at') },
  });

  return NextResponse.json({ task: data });
}
