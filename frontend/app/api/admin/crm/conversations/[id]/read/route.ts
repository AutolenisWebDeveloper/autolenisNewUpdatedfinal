import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { requirePermissionActor } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

// Marks a conversation read. Read-state-only — no audit log entry.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actor = await requirePermissionActor("crm.manage");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const supabase = getServiceSupabase();
  const now = new Date().toISOString();

  await supabase
    .from('conversation_messages')
    .update({ read_at: now })
    .eq('conversation_id', id)
    .is('read_at', null);

  await supabase
    .from('conversations')
    .update({ unread_count: 0, updated_at: now })
    .eq('id', id);

  return NextResponse.json({ ok: true });
}
