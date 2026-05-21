import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { WorkflowService } from '@/lib/services/workflow.service';
import { getAdminActorId } from '@/lib/auth/admin-actor';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string; versionId: string }>;
}

export async function POST(_req: Request, ctx: RouteContext) {
  const { id, versionId } = await ctx.params;
  const supabase = getServiceSupabase();
  const adminId = await getAdminActorId();
  try {
    const workflow = await WorkflowService.restoreVersion(supabase, id, versionId, adminId);
    return NextResponse.json({ workflow });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'RESTORE_FAILED';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
