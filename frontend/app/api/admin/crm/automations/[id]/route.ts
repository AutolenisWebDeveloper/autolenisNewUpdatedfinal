import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { WorkflowService } from '@/lib/services/workflow.service';
import { requirePermissionActor } from '@/lib/auth/permissions';
import type { WorkflowUpdate } from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const actor = await requirePermissionActor("crm.read");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await ctx.params;
  const supabase = getServiceSupabase();
  try {
    const workflow = await WorkflowService.getWorkflow(supabase, id);
    if (!workflow) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const versions = await WorkflowService.listVersions(supabase, id);
    return NextResponse.json({ workflow, versions });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'LOAD_FAILED';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  let body: WorkflowUpdate;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const actor = await requirePermissionActor("crm.manage");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const supabase = getServiceSupabase();
  try {
    const workflow = await WorkflowService.updateWorkflow(supabase, id, body, actor);
    return NextResponse.json({ workflow });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UPDATE_FAILED';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const actor = await requirePermissionActor("crm.manage");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const supabase = getServiceSupabase();
  try {
    await WorkflowService.deleteWorkflow(supabase, id, actor);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'DELETE_FAILED';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
