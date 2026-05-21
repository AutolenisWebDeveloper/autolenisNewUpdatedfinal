import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';

export const dynamic = 'force-dynamic';

const VALID_STATUSES = ['open', 'in_progress', 'completed', 'deferred'] as const;
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const VALID_SCOPES = ['contact', 'system', 'admin'] as const;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status') ?? 'open,in_progress';
  const statuses = statusParam
    .split(',')
    .map((s) => s.trim())
    .filter((s) => (VALID_STATUSES as readonly string[]).includes(s));

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('crm_tasks')
    .select(
      `
        *,
        contact:contacts ( id, first_name, last_name, email )
      `,
    )
    .in('status', statuses.length > 0 ? statuses : ['open', 'in_progress'])
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    title?: string;
    description?: string;
    priority?: string;
    scope?: string;
    contact_id?: string | null;
    due_at?: string | null;
    assigned_to?: string | null;
    source?: string | null;
  };

  const title = (body.title ?? '').trim();
  if (!title) return NextResponse.json({ error: 'TITLE_REQUIRED' }, { status: 400 });

  const priority = (VALID_PRIORITIES as readonly string[]).includes(body.priority ?? '')
    ? body.priority
    : 'medium';
  const scope = (VALID_SCOPES as readonly string[]).includes(body.scope ?? '')
    ? body.scope
    : 'contact';

  if (scope === 'contact' && !body.contact_id) {
    return NextResponse.json({ error: 'CONTACT_REQUIRED_FOR_CONTACT_SCOPE' }, { status: 400 });
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('crm_tasks')
    .insert({
      title,
      description: body.description ?? null,
      priority,
      scope,
      contact_id: body.contact_id ?? null,
      due_at: body.due_at ?? null,
      assigned_to: body.assigned_to ?? null,
      source: body.source ?? 'admin',
      status: 'open',
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (data.contact_id) {
    await supabase.from('contact_timeline_events').insert({
      contact_id: data.contact_id,
      event_type: 'task_created',
      event_data: { task_id: data.id, title: data.title },
    });
  }

  return NextResponse.json({ task: data });
}
