import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();

  if (q.length < 2) {
    return NextResponse.json({ contacts: [] });
  }

  const supabase = getServiceSupabase();
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  const { data, error } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, email, phone, lifecycle_stage')
    .is('deleted_at', null)
    .or(
      `email.ilike.${like},phone.ilike.${like},first_name.ilike.${like},last_name.ilike.${like}`,
    )
    .limit(8);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contacts: data ?? [] });
}
