import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
