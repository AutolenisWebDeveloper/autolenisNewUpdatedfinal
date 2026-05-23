import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { getAdminActor } from '@/lib/auth/admin-actor';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';

export const dynamic = 'force-dynamic';

type EscalateBody = {
  admin_id?: string | null;
};

// PATCH /api/admin/crm/conversations/[id]/escalate
//
// Flips a conversation to status='escalated' and assigns it to the chosen
// admin (or the calling admin when admin_id is omitted). Records an audit-log
// entry and a contact timeline event so the action is recoverable.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actor = await getAdminActor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const supabase = getServiceSupabase();

  let body: EscalateBody = {};
  try {
    body = (await req.json()) as EscalateBody;
  } catch {
    // Empty body is allowed — falls through to caller-as-assignee.
  }

  const callerId = actor.adminId;
  const assigneeId = body.admin_id ?? callerId;

  const { data: before, error: fetchError } = await supabase
    .from('conversations')
    .select('id, status, assigned_to, contact_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from('conversations')
    .update({
      status: 'escalated',
      assigned_to: assigneeId,
      updated_at: nowIso,
    })
    .eq('id', id)
    .select('id, status, assigned_to, contact_id')
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Best-effort timeline event — the conversation update is the authoritative
  // state change, so we never roll back if the timeline insert fails.
  await supabase
    .from('contact_timeline_events')
    .insert({
      contact_id: updated.contact_id,
      event_type: 'admin_action',
      event_data: {
        action: 'conversation_escalated',
        conversation_id: updated.id,
        assigned_to: assigneeId,
        from_status: before.status,
      },
      created_by: callerId,
    });

  await writeCrmAuditLog(supabase, actor, {
    action: 'ESCALATE_CONVERSATION',
    entity_type: 'conversation',
    entity_id: id,
    previous_state: { status: before.status, assigned_to: before.assigned_to },
    new_state: { status: 'escalated', assigned_to: assigneeId },
  });

  return NextResponse.json({
    ok: true,
    conversation: updated,
  });
}
