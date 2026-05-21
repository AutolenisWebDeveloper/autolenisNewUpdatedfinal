import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';

export const dynamic = 'force-dynamic';

const VALID_STATUSES = ['open', 'assigned', 'escalated', 'resolved'] as const;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status');
  const statuses = statusParam
    ? statusParam.split(',').filter((s) => (VALID_STATUSES as readonly string[]).includes(s))
    : [];

  const supabase = getServiceSupabase();
  let query = supabase
    .from('conversations')
    .select(
      `
        id, contact_id, phone, channel, assigned_to, unread_count, status,
        last_message_at, created_at, updated_at,
        contact:contacts ( first_name, last_name, email )
      `,
    )
    .order('last_message_at', { ascending: false })
    .limit(100);

  if (statuses.length > 0) query = query.in('status', statuses);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (data ?? []).map((c) => c.id);
  let previews: Record<string, { body: string; direction: string; created_at: string }> = {};

  if (ids.length > 0) {
    const { data: msgs } = await supabase
      .from('conversation_messages')
      .select('conversation_id, body, direction, created_at')
      .in('conversation_id', ids)
      .order('created_at', { ascending: false });

    previews = (msgs ?? []).reduce<typeof previews>((acc, m) => {
      if (!acc[m.conversation_id]) {
        acc[m.conversation_id] = {
          body: m.body,
          direction: m.direction,
          created_at: m.created_at,
        };
      }
      return acc;
    }, {});
  }

  const enriched = (data ?? []).map((c) => ({
    ...c,
    last_message: previews[c.id] ?? null,
  }));

  return NextResponse.json({ data: enriched });
}
