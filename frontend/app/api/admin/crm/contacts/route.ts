import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { ContactService } from '@/lib/services/contact.service';
import { requirePermissionActor } from '@/lib/auth/permissions';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';
import type { Contact, ContactInput, ContactSource } from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

const VALID_SOURCES: ContactSource[] = [
  'buyer_signup',
  'dealer_signup',
  'affiliate_signup',
  'public_form',
  'sms_inbound',
  'import',
];

const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 100;

export async function GET(req: Request) {
  const actor = await requirePermissionActor("crm.read");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

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

export async function POST(req: Request) {
  const actor = await requirePermissionActor("crm.manage");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  let body: Partial<ContactInput> & { notes?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  if (!body.email && !body.phone) {
    return NextResponse.json(
      { error: 'EMAIL_OR_PHONE_REQUIRED' },
      { status: 400 },
    );
  }

  const source = (body.source ?? 'public_form') as ContactSource;
  if (!VALID_SOURCES.includes(source)) {
    return NextResponse.json({ error: 'INVALID_SOURCE' }, { status: 400 });
  }

  const supabase = getServiceSupabase();
  try {
    const contact = await ContactService.upsertContact(supabase, {
      email: body.email ?? null,
      phone: body.phone ?? null,
      firstName: body.firstName,
      lastName: body.lastName,
      source,
      consentEmail: !!body.consentEmail,
      consentSms: !!body.consentSms,
      consentText: body.consentText,
    });

    if (body.notes) {
      await supabase
        .from('contacts')
        .update({ notes: body.notes })
        .eq('id', contact.id);
      contact.notes = body.notes;
    }

    await writeCrmAuditLog(supabase, actor, {
      action: 'CRM_CONTACT_CREATED',
      entity_type: 'contact',
      entity_id: contact.id,
      new_state: contact,
    });

    return NextResponse.json({ contact }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'CREATE_FAILED';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
