import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { WorkflowService } from '@/lib/services/workflow.service';
import { requirePermissionActor } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const actor = await requirePermissionActor("crm.manage");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const supabase = getServiceSupabase();
  try {
    const workflow = await WorkflowService.activateWorkflow(supabase, id, actor);
    return NextResponse.json({ workflow });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ACTIVATE_FAILED';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
