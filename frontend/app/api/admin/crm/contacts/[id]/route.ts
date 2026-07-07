import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { ContactService } from '@/lib/services/contact.service';
import { requirePermissionActor } from '@/lib/auth/permissions';
import type { ContactUpdate } from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await requirePermissionActor("crm.read");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;
  const supabase = getServiceSupabase();

  const contact = await ContactService.getContactById(supabase, id);
  if (!contact) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const [{ data: identities }, { count: openTaskCount }] = await Promise.all([
    supabase
      .from('contact_identities')
      .select('id, entity_type, entity_id, is_primary')
      .eq('contact_id', id),
    supabase
      .from('crm_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('contact_id', id)
      .in('status', ['open', 'in_progress']),
  ]);

  return NextResponse.json({
    contact,
    identities: identities ?? [],
    open_task_count: openTaskCount ?? 0,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actor = await requirePermissionActor("crm.manage");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const body = (await req.json()) as ContactUpdate;
  const supabase = getServiceSupabase();

  try {
    const updated = await ContactService.updateContact(supabase, id, body, actor);
    return NextResponse.json({ contact: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UPDATE_FAILED';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actor = await requirePermissionActor("crm.manage");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const supabase = getServiceSupabase();

  await ContactService.softDeleteContact(supabase, id, actor);
  return NextResponse.json({ deleted: true });
}
