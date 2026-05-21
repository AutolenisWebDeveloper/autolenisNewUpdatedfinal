import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import type { TimelineEvent, Contact } from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 100;

type ContactJoin = Pick<Contact, 'id' | 'first_name' | 'last_name' | 'email' | 'phone'>;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const channel = url.searchParams.get('channel'); // 'email' | 'sms' | null
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, Number(url.searchParams.get('per_page') ?? DEFAULT_PER_PAGE) || DEFAULT_PER_PAGE),
  );

  const supabase = getServiceSupabase();

  let eventTypes: string[] = ['email_sent', 'sms_sent'];
  if (channel === 'email') eventTypes = ['email_sent'];
  else if (channel === 'sms') eventTypes = ['sms_sent'];

  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  const { data, count, error } = await supabase
    .from('contact_timeline_events')
    .select('*, contact:contacts(id, first_name, last_name, email, phone)', { count: 'exact' })
    .in('event_type', eventTypes)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as (TimelineEvent & { contact: ContactJoin | null })[];

  return NextResponse.json({
    data: rows,
    total: count ?? 0,
    page,
    per_page: perPage,
    has_more: (count ?? 0) > to + 1,
  });
}
