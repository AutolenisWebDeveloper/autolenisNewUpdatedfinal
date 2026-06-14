import { NextResponse } from 'next/server';
import { getAdminActor } from '@/lib/auth/admin-actor';
import { getServiceSupabase } from '@/lib/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const actor = await getAdminActor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const supabase = getServiceSupabase();

  const [{ data: unreadRows }, { count: overdueCount }] = await Promise.all([
    supabase
      .from('conversations')
      .select('unread_count')
      .gt('unread_count', 0),
    supabase
      .from('crm_tasks')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'in_progress'])
      .lt('due_at', new Date().toISOString()),
  ]);

  const unread = (unreadRows ?? []).reduce(
    (acc, row) => acc + (row.unread_count ?? 0),
    0,
  );

  return NextResponse.json({
    unread,
    overdue: overdueCount ?? 0,
  });
}
