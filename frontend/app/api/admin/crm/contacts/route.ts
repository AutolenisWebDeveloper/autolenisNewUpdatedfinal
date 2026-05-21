import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import type { Contact } from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 100;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const stage = url.searchParams.get('stage');
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, Number(url.searchParams.get('per_page') ?? DEFAULT_PER_PAGE) || DEFAULT_PER_PAGE),
  );

  const supabase = getServiceSupabase();
  let query = supabase
    .from('contacts')
    .select('*', { count: 'exact' })
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (stage) query = query.eq('lifecycle_stage', stage);

  if (q.length >= 1) {
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    query = query.or(
      `email.ilike.${like},phone.ilike.${like},first_name.ilike.${like},last_name.ilike.${like}`,
    );
  }

  const from = (page - 1) * perPage;
  const to = from + perPage - 1;
  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    data: (data ?? []) as Contact[],
    total: count ?? 0,
    page,
    per_page: perPage,
    has_more: (count ?? 0) > to + 1,
  });
}
