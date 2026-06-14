import { NextResponse } from 'next/server';
import { getAdminActor } from '@/lib/auth/admin-actor';
import { getServiceSupabase } from '@/lib/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getAdminActor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from('conversation_messages')
    .select('*')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}
