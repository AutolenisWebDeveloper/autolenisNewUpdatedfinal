// /api/admin/crm/suppression — CAN-SPAM / TCPA suppression list management.
// GET    ?type=email|sms&search=   → list suppression entries
// POST   { type, value, reason? } → add a manual suppression (crm.manage)
// DELETE { type: "email", value } → remove an email suppression (crm.manage,
//         audit-logged via SuppressionService). SMS unsuppression is
//         intentionally NOT exposed: TCPA re-opt-in goes through the START
//         review task flow, never an admin toggle.
import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { requirePermissionActor } from '@/lib/auth/permissions';
import { SuppressionService } from '@/lib/services/suppression.service';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';
import { normalizeEmail, normalizePhone } from '@/lib/utils/phone';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await requirePermissionActor('crm.read');
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const url = new URL(req.url);
  const type = url.searchParams.get('type') === 'sms' ? 'sms' : 'email';
  const search = (url.searchParams.get('search') ?? '').trim();
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '100', 10) || 100));

  const supabase = getServiceSupabase();
  const table = type === 'sms' ? 'sms_suppression' : 'email_suppression';
  const column = type === 'sms' ? 'phone' : 'email';

  let query = supabase
    .from(table)
    .select('*', { count: 'exact' })
    .order('suppressed_at', { ascending: false })
    .limit(limit);
  if (search) query = query.ilike(column, `%${search}%`);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: 'QUERY_FAILED' }, { status: 500 });
  return NextResponse.json({ data: data ?? [], total: count ?? 0 });
}

export async function POST(req: Request) {
  const actor = await requirePermissionActor('crm.manage');
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { type?: string; value?: string } | null;
  if (!body?.type || !body.value) {
    return NextResponse.json({ error: 'type and value are required' }, { status: 400 });
  }
  const supabase = getServiceSupabase();

  if (body.type === 'email') {
    const clean = normalizeEmail(body.value);
    if (!clean) return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    await SuppressionService.suppressEmail(supabase, clean, 'admin_added', {
      addedBy: actor.adminEmail,
    });
    await writeCrmAuditLog(supabase, actor, {
      action: 'SUPPRESS_EMAIL',
      entity_type: 'email_suppression',
      entity_id: clean,
      previous_state: null,
      new_state: { reason: 'admin_added' },
    });
    return NextResponse.json({ suppressed: clean }, { status: 201 });
  }
  if (body.type === 'sms') {
    const clean = normalizePhone(body.value);
    if (!clean) return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    await SuppressionService.suppressSms(supabase, clean, 'admin_added');
    await writeCrmAuditLog(supabase, actor, {
      action: 'SUPPRESS_SMS',
      entity_type: 'sms_suppression',
      entity_id: clean,
      previous_state: null,
      new_state: { reason: 'admin_added' },
    });
    return NextResponse.json({ suppressed: clean }, { status: 201 });
  }
  return NextResponse.json({ error: 'type must be email or sms' }, { status: 400 });
}

export async function DELETE(req: Request) {
  const actor = await requirePermissionActor('crm.manage');
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { type?: string; value?: string } | null;
  if (body?.type !== 'email' || !body.value) {
    // SMS unsuppression is deliberately unsupported (TCPA START review flow).
    return NextResponse.json({ error: 'Only email unsuppression is supported' }, { status: 400 });
  }
  const clean = normalizeEmail(body.value);
  if (!clean) return NextResponse.json({ error: 'Invalid email' }, { status: 400 });

  const supabase = getServiceSupabase();
  await SuppressionService.unsuppressEmail(supabase, clean, actor);
  return NextResponse.json({ unsuppressed: clean });
}
