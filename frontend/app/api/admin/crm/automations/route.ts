import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { WorkflowService } from '@/lib/services/workflow.service';
import { getPrebuilt } from '@/lib/services/workflow.prebuilt';
import { requirePermissionActor } from '@/lib/auth/permissions';
import type { WorkflowStatus, WorkflowInput } from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await requirePermissionActor("crm.read");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get('status') as WorkflowStatus | null;
  const search = url.searchParams.get('search') ?? undefined;
  const includeStats = url.searchParams.get('include_stats') === '1';

  const supabase = getServiceSupabase();
  try {
    const workflows = await WorkflowService.listWorkflows(supabase, {
      status: status ?? undefined,
      search,
    });
    const stats = includeStats
      ? await WorkflowService.getStatsForWorkflows(supabase, workflows.map((w) => w.id))
      : {};
    return NextResponse.json({ data: workflows, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'LIST_FAILED';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: (WorkflowInput & { from_prebuilt?: string }) | undefined;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }
  if (!body) return NextResponse.json({ error: 'BODY_REQUIRED' }, { status: 400 });

  const actor = await requirePermissionActor("crm.manage");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const supabase = getServiceSupabase();

  // Cloning a prebuilt → seed the workflow with the template graph but mark
  // it as a normal draft so the admin can customize freely.
  if (body.from_prebuilt) {
    const prebuilt = getPrebuilt(body.from_prebuilt);
    if (!prebuilt) return NextResponse.json({ error: 'PREBUILT_NOT_FOUND' }, { status: 404 });
    try {
      const workflow = await WorkflowService.createWorkflow(
        supabase,
        {
          name: body.name?.trim() || prebuilt.name,
          description: body.description ?? prebuilt.description,
          trigger_type: prebuilt.trigger_type,
          trigger_config: {},
          nodes: prebuilt.graph,
          is_prebuilt: false,
          prebuilt_key: prebuilt.key,
        },
        actor,
      );
      return NextResponse.json({ workflow }, { status: 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'CREATE_FAILED';
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  try {
    const workflow = await WorkflowService.createWorkflow(supabase, body, actor);
    return NextResponse.json({ workflow }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'CREATE_FAILED';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
