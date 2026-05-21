import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { WorkflowService } from '@/lib/services/workflow.service';
import { getAdminActorId } from '@/lib/auth/admin-actor';
import type { WorkflowUpdate } from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
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

  const supabase = getServiceSupabase();
  const adminId = await getAdminActorId();
  try {
    const workflow = await WorkflowService.updateWorkflow(supabase, id, body, adminId);
    return NextResponse.json({ workflow });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UPDATE_FAILED';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const supabase = getServiceSupabase();
  const adminId = await getAdminActorId();
  try {
    await WorkflowService.deleteWorkflow(supabase, id, adminId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'DELETE_FAILED';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
