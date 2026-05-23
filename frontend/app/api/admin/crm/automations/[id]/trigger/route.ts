import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { WorkflowEngine } from '@/lib/services/workflow.engine';
import { getAdminActor } from '@/lib/auth/admin-actor';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Admin manual trigger — enroll a specific contact into a specific workflow.
// Bypasses trigger_type matching because the admin is explicitly choosing the
// pairing (used for back-filling, debugging, or one-off sends).
export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const actor = await getAdminActor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  let body: { contact_id?: string; trigger_data?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }
  if (!body.contact_id) {
    return NextResponse.json({ error: 'CONTACT_ID_REQUIRED' }, { status: 400 });
  }

  const supabase = getServiceSupabase();
  try {
    const enrollment = await WorkflowEngine.enrollContact(
      supabase,
      id,
      body.contact_id,
      { ...(body.trigger_data ?? {}), source: 'manual_trigger' },
    );
    if (!enrollment) {
      return NextResponse.json({ status: 'SKIPPED', reason: 'INACTIVE_OR_DUPLICATE' });
    }
    await writeCrmAuditLog(supabase, actor, {
      action: 'WORKFLOW_MANUAL_TRIGGER',
      entity_type: 'workflow',
      entity_id: id,
      metadata: { contact_id: body.contact_id, enrollment_id: enrollment.id ?? null },
    });
    return NextResponse.json({ status: 'ENROLLED', enrollment });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'TRIGGER_FAILED';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
