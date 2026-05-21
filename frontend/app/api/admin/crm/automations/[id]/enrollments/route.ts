import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Lists most recent enrollments for a workflow + per-status counts. Powers the
// workflow detail page and the operations panel's "failed enrollments" table.
export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200);

  const supabase = getServiceSupabase();
  let query = supabase
    .from('workflow_enrollments')
    .select(`
      id, status, current_node_id, enrolled_at, completed_at, exited_at, exit_reason,
      contact:contacts ( id, first_name, last_name, email, phone )
    `)
    .eq('workflow_id', id)
    .order('enrolled_at', { ascending: false })
    .limit(limit);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}
